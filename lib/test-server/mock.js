'use strict';

/**
 * @typedef { import("http").ClientRequest } ClientRequest
 * @typedef { import("http").ServerResponse } ServerResponse
 */

const { error, info } = require('../utils/log.js');
const { isInvalidFilePath, isJsonFilePath } = require('../utils/is.js');
const chalk = require('chalk');
const config = require('../config.js');
const debug = require('debug')('dvlp:mock');
const { getProjectPath } = require('../utils/file.js');
const fs = require('fs');
const { interceptClientRequest } = require('../utils/intercept.js');
const mime = require('mime');
const path = require('path');
const send = require('send');
const stopwatch = require('../utils/stopwatch.js');
const { URL } = require('url');

module.exports = class Mock {
  /**
   * Constructor
   *
   * @param { string | Array<string> } [filePaths]
   */
  constructor(filePaths) {
    this.cache = new Map();
    this.mocking = false;
    this.uninterceptClientRequest = () => {};
    this.clean = this.clean.bind(this);

    if (filePaths) {
      this.load(filePaths);
    }
  }

  /**
   * Add new mock for 'res'
   *
   * @param { string | object } req
   * @param { object } res
   * @param { boolean } once
   */
  add(req, res, once) {
    if (!res.body) {
      res = { body: res, headers: {} };
    }

    const url = getUrl(req);
    const key = getCacheKey(url);
    const ignoreSearch = req.ignoreSearch || false;
    const search = ignoreSearch || !url.search ? 'default' : url.search;
    const type =
      typeof res.body === 'string'
        ? isInvalidFilePath(res.body)
          ? 'html'
          : 'file'
        : 'json';
    const filePath = req.filePath || path.join(process.cwd(), 'mock');
    // Allow multiple (subkeyed on search)
    const mock = this.cache.get(key) || {};

    mock[search] = {
      key: search,
      filePath,
      url,
      ignoreSearch,
      once,
      type,
      response: res
    };

    if (!this.mocking) {
      this.mocking = true;
      this.initRequestInterception();
    }
    this.cache.set(key, mock);
    debug(`adding mocked "${url.href}"`);
  }

  /**
   * Load mock files from disk
   *
   * @param { string | Array<string> } filePaths
   */
  load(filePaths) {
    if (!Array.isArray(filePaths)) {
      filePaths = [filePaths];
    }

    for (let filePath of filePaths) {
      filePath = path.resolve(filePath);

      try {
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          this.loadDirectory(filePath);
        } else {
          this.loadFile(filePath);
        }
      } catch (err) {
        error(`unable to find mock file ${filePath}`);
      }
    }
  }

  /**
   * Match and handle mock response for 'req'
   *
   * @param { string | ClientRequest } req
   * @param { ServerResponse } [res]
   * @returns { boolean | object }
   */
  match(req, res) {
    const mock = this.getMock(req);

    if (!mock) {
      return false;
    }

    if (!res) {
      return mock;
    }

    const {
      once,
      response: { hang, error, missing, offline }
    } = mock;

    if (once) {
      this.remove(req);
    }

    // Handle special status
    if (hang) {
      return;
    } else if (error || missing) {
      const statusCode = error ? 500 : 404;
      const body = error ? 'error' : 'missing';

      res.writeHead(statusCode);
      res.end(body);
      return;
    } else if (offline) {
      req.socket.destroy();
      return;
    }

    debug(`sending mocked "${mock.url.href}"`);

    const {
      filePath,
      response: { body, headers = {} },
      type
    } = mock;
    let content = body;

    switch (type) {
      case 'file':
        // Body is path to file (relative to mock file)
        send(
          { url: req, headers: {} },
          path.resolve(path.dirname(filePath), body),
          {
            cacheControl: true,
            dotfiles: 'allow',
            maxAge: config.maxAge
          }
        ).pipe(res);
        return;
      case 'json':
        content = JSON.stringify(body);
        break;
    }

    res.writeHead(200, {
      // Allow type to be overwritten
      'Content-Type': mime.getType(type),
      ...headers,
      'Content-Length': Buffer.byteLength(content),
      // Overwrite Date
      Date: new Date().toUTCString()
    });
    res.end(content);

    info(
      `${stopwatch.stop(
        res.url,
        true,
        true
      )} handled mocked request for ${chalk.green(req.url ? req.url : req)}`
    );

    return true;
  }

  /**
   * Determine if 'url' matches 'mock'
   * If not defined, 'mock' will be retrieved from cache
   *
   * @param { URL } url
   * @returns { boolean }
   */
  hasMatch(url) {
    return this.getMock(url) !== undefined;
  }

  /**
   * Remove existing mock
   *
   * @param { string | ClientRequest } req
   */
  remove(req) {
    const { key } = this.getMock(req);
    const url = getUrl(req);
    const cacheKey = getCacheKey(url);
    const mock = this.cache.get(cacheKey);

    delete mock[key];

    if (!Object.keys(mock).length) {
      this.cache.delete(cacheKey);
      if (!this.cache.size) {
        this.mocking = false;
        this.uninterceptClientRequest();
      }
    }
  }

  /**
   * Clear all mocks
   */
  clean() {
    this.mocking = false;
    this.uninterceptClientRequest();
    this.cache.clear();
  }

  /**
   * Initialize request interception
   * @private
   */
  initRequestInterception() {
    this.uninterceptClientRequest = interceptClientRequest((url) => {
      if (this.hasMatch(url.href)) {
        url.searchParams.append('mock', url.href);
        // Reroute to active server
        url.host = `localhost:${config.activePort}`;
      }
    });
  }

  /**
   * Retrieve mock
   *
   * @param { string | ClientRequest } req
   * @returns { object }
   * @private
   */
  getMock(req) {
    const url = getUrl(req);
    const key = getCacheKey(url);
    const mock = this.cache.get(key);

    if (!mock) {
      return;
    } else if (!url.search) {
      return mock.default;
    } else if (url.search in mock) {
      return mock[url.search];
    } else {
      if (mock.default && mock.default.ignoreSearch) {
        return mock.default;
      }
    }
  }

  /**
   * Load directory at 'dirpath'
   *
   * @param { string } dirpath
   * @private
   */
  loadDirectory(dirpath) {
    fs.readdirSync(dirpath).forEach((filePath) => {
      this.load(path.join(dirpath, filePath));
    });
  }

  /**
   * Load file at 'filePath'
   *
   * @param { string } filePath
   * @private
   */
  loadFile(filePath) {
    if (!isJsonFilePath(filePath)) {
      return;
    }

    try {
      let mocks = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      if (!Array.isArray(mocks)) {
        mocks = [mocks];
      }

      for (const mock of mocks) {
        if (!isMockFile(mock)) {
          return;
        } else if (!isValidSchema(mock)) {
          return error(`invalid mock format for ${filePath}`);
        }

        const { request, response } = mock;

        request.filePath = filePath;
        this.add(request, response, false);
      }

      info(
        `${chalk.green('✔')} loaded ${mocks.length} mock response${
          mocks.length > 1 ? 's' : ''
        } from ${chalk.green(getProjectPath(filePath))}`
      );
    } catch (err) {
      error(err);
    }
  }
};

function isMockFile(json) {
  return 'request' in json || 'response' in json;
}

/**
 * Validate that 'json' is correct format
 *
 * @param { object } json
 * @returns { boolean }
 * @private
 */
function isValidSchema(json) {
  return (
    'request' in json &&
    'response' in json &&
    'url' in json.request &&
    'body' in json.response
  );
}

/**
 * Retrieve URL instance from 'req'
 *
 * @param { string | object | URL } req
 * @returns { URL }
 * @private
 */
function getUrl(req) {
  if (!(req instanceof URL)) {
    req = new URL(
      typeof req === 'string' ? req : req.url,
      `http://localhost:${config.activePort}`
    );
  }
  // Map loopback address to localhost
  if (req.hostname === '127.0.0.1') {
    req.hostname = 'localhost';
  }

  return req;
}

/**
 * Retrieve key for 'url'
 *
 * @param { URL } url
 * @returns { string }
 * @private
 */
function getCacheKey(url) {
  // Map loopback address to localhost
  const host = url.host === '127.0.0.1' ? 'localhost' : url.host;
  let key = path.join(host, url.pathname);

  return key;
}