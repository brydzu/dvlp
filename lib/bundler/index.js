'use strict';

const { info, error } = require('../utils/log.js');
const {
  isJsFilePath,
  isNodeModuleFilePath,
  isPromise
} = require('../utils/is.js');
const bundler = require('./bundle-worker.js');
const config = require('../config.js');
const chalk = require('chalk');
const debug = require('debug')('dvlp:module');
const fs = require('fs');
const { getCachedPackage } = require('../resolver/index.js');
const path = require('path');
const stopwatch = require('../utils/stopwatch.js');
const workerFarm = require('worker-farm');

const cache = new Map();
let workers;

if (config.maxModuleBundlerWorkers) {
  debug(`bundling modules with ${config.maxModuleBundlerWorkers} workers`);
}

if (fs.existsSync(config.bundleDir)) {
  const names = new Map();

  fs.readdirSync(config.bundleDir)
    .filter(isJsFilePath)
    .forEach((resolvedId) => {
      const name = resolvedId.slice(0, resolvedId.lastIndexOf('-'));

      if (!names.has(name)) {
        cache.set(resolvedId, true);
        names.set(name, resolvedId);
      } else {
        // Clear instances if duplicates with different versions
        const existing = names.get(name);

        cache.delete(existing);
        fs.unlinkSync(path.resolve(config.bundleDir, existing));
        fs.unlinkSync(path.resolve(config.bundleDir, resolvedId));
      }
    });
}

module.exports = {
  bundle,
  cleanBundles,
  destroyWorkers,
  resolveModuleId,
  resolveModulePath
};

/**
 * Resolve module id into cacheable id
 *
 * @param { string } id
 * @param { string } filePath
 * @returns { string }
 */
function resolveModuleId(id, filePath) {
  if (!isNodeModuleFilePath(filePath)) {
    return '';
  }

  const pkg = getCachedPackage(path.dirname(filePath));

  return `${encodeId(id)}-${pkg.version}.js`;
}

/**
 * Retrieve path to cached 'resolvedId'
 *
 * @param { string } resolvedId
 * @returns { string }
 */
function resolveModulePath(resolvedId) {
  return path.join(config.bundleDir, resolvedId);
}

/**
 * Trigger bundle of 'id'
 *
 * @param { string } resolvedId
 * @param { string } [id]
 * @param { object } [rollupConfig]
 * @returns { Promise<string> }
 */
function bundle(resolvedId, id, rollupConfig) {
  if (!resolvedId) {
    return null;
  }
  if (!id) {
    id = decodeId(resolvedId.slice(0, resolvedId.lastIndexOf('-')));
  }
  const filePath = resolveModulePath(resolvedId);

  if (!cache.has(resolvedId)) {
    return doBundle(id, resolvedId, filePath, rollupConfig);
  } else if (isPromise(cache.get(resolvedId))) {
    return cache.get(resolvedId);
  } else {
    return Promise.resolve(filePath);
  }
}

/**
 * Bundle module at 'id'
 *
 * @param { string } id
 * @param { string } resolvedId
 * @param { string } filePath
 * @param { object } [rollupConfig]
 * @returns { Promise<string> }
 */
function doBundle(id, resolvedId, filePath, rollupConfig) {
  const promiseToCache = new Promise(async (resolve, reject) => {
    stopwatch.start(id);

    getBundler()(id, filePath, rollupConfig, (err) => {
      if (err) {
        error(`unable to bundle ${id}`);
        cache.delete(resolvedId);
        return reject(err);
      }

      // Can't use file.getProjectPath() here because of circular dependency
      info(
        `${stopwatch.stop(id, true, true)} bundled ${chalk.green(
          id
        )} as ${chalk.green(path.relative(process.cwd(), filePath))}`
      );
      cache.set(resolvedId, true);
      resolve(filePath);
    });
  });

  cache.set(resolvedId, promiseToCache);
  return promiseToCache;
}

/**
 * Retrieve bundler.
 * Starts workers if config.maxModuleBundlerWorkers > 0,
 * otherwise uses bundler directly
 *
 * @returns { (id: string, outputPath: string, overrideOptions: object, fn: (err: Error) => void) => void }
 */
function getBundler() {
  if (!config.maxModuleBundlerWorkers) {
    return bundler;
  }

  if (!workers) {
    workers = workerFarm(
      { maxConcurrentWorkers: config.maxModuleBundlerWorkers },
      path.resolve(__dirname, './bundle-worker.js')
    );
    debug(`spawned ${config.maxModuleBundlerWorkers} bundler workers`);
  }

  return workers;
}

/**
 * Clear memory and disk cache
 */
function cleanBundles() {
  for (const resolvedId of cache) {
    try {
      fs.unlinkSync(resolveModulePath(resolvedId));
    } catch (err) {
      // ignore
    } finally {
      cache.delete(resolvedId);
    }
  }
}

/**
 * Terminate workers
 */
function destroyWorkers() {
  return new Promise((resolve, reject) => {
    if (!workers) {
      return resolve();
    }

    workerFarm.end(workers, (msg) => {
      workers = undefined;
      if (msg) {
        return reject(Error(msg));
      }
      resolve();
    });
  });
}

function encodeId(id) {
  return id.replace(/\//g, '__');
}

function decodeId(id) {
  return id.replace(/__/g, '/');
}
