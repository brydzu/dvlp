'use strict';

/**
 * @typedef { object } PushStream
 * @property { string } url
 * @property { string } type
 */
/**
 * @typedef { object } PushEvent
 * @property { string | object } message
 * @property { object } [options]
 * @property { string } [options.event]
 * @property { string } [options.id]
 */

const { isWebSocketUrl, getUrl, getUrlCacheKey } = require('../utils/url.js');
const debug = require('debug')('dvlp:push');
const deflate = require('permessage-deflate');
const { error } = require('../utils/log.js');
const WebSocket = require('faye-websocket');
const { EventSource } = WebSocket;

const DEFAULT_ES_CONFIG = {
  headers: { 'Access-Control-Allow-Origin': '*' },
  ping: 15,
  retry: 10
};
const RE_SOCKETIO_PROTOCOL = /socket\.?io|EIO/;

/**
 * @type { Map<string, Set<object>> }
 */
const cache = new Map();

module.exports = {
  connectClient,
  destroyClients,
  pushEvent
};

/**
 * Initialize EventSource/WebSocket client
 *
 * @param { string | PushStream } stream
 * @param { ...any } args
 * @returns { void }
 */
function connectClient(stream, ...args) {
  const { type, url } = getStream(stream);
  const cacheKey = getUrlCacheKey(getUrl(url));
  const clients = cache.get(cacheKey) || new Set();
  let client;

  if (type === 'ws') {
    const [req, socket, body] = args;
    const isSocketio = RE_SOCKETIO_PROTOCOL.test(req.url);
    const extensionsHeaders = req.headers['Sec-WebSocket-Extensions'];
    const extensions =
      extensionsHeaders && extensionsHeaders.includes('permessage-deflate')
        ? [deflate]
        : [];

    client = new WebSocket(req, socket, body, [], { extensions });
    client.on('message', (event) => {
      debug('received ws message', event.data);

      // Handle Socket.io channel protocol
      // ex: 40/channel?somequery=foo
      if (isSocketio) {
        const [packetAndChannel] = event.data.split('?');

        // Send separate packet and packet/channel responses
        if (packetAndChannel.includes('/')) {
          client.send(packetAndChannel.slice(0, packetAndChannel.indexOf('/')));
          client.send(packetAndChannel);
        }
      }
    });
    if (isSocketio) {
      client.send(
        '0{"sid":"dvlp","upgrades":[],"pingInterval":250000,"pingTimeout":600000}'
      );
    }
  } else {
    const [req, res] = args;

    client = new EventSource(req, res, DEFAULT_ES_CONFIG);
  }

  clients.add(client);
  cache.set(cacheKey, clients);
  debug(`added ${type} connection`, clients.size);

  client.on('close', () => {
    clients.delete(client);
    if (!clients.size) {
      cache.delete(cacheKey);
    }
    debug(`removed ${type} connection`, cache.size);
  });
}

/**
 * Push event data to WebSocket/EventSource clients
 *
 * @param { string | PushStream } stream
 * @param { PushEvent } event
 * @returns { void }
 */
function pushEvent(stream, event) {
  if (!stream || !event) {
    return;
  }

  const { url, type } = getStream(stream);
  const cacheKey = getUrlCacheKey(getUrl(url));
  const clients = cache.get(cacheKey);

  if (clients === undefined) {
    return error(`no push clients registered for ${url}`);
  }

  let { message, options } = event;

  if (!(typeof message === 'string')) {
    try {
      message = JSON.stringify(message);
    } catch (err) {
      return error(`unable to stringify message for push event`, message);
    }
  }
  if (type === 'ws' && options !== undefined) {
    const { event = '', namespace = '/', protocol } = options;

    // Handle socket.io protocol
    // https://github.com/socketio/socket.io-protocol/blob/master/Readme.md
    if (protocol && RE_SOCKETIO_PROTOCOL.test(protocol)) {
      message = `42${namespace},["${event}",${message}]`;
      // message = `${Buffer.from(message).length}:${message}`;
    }
    options = undefined;
  }

  debug(
    `push to ${clients.size} client${
      clients.size > 1 ? 's' : ''
    } connected on ${url}`
  );
  debug(message);
  for (const client of clients) {
    client.send(message, options);
  }
}

/**
 * Destroy all active push clients for connection at 'url'
 * If 'url' not defined, destroys all clients for all connections
 *
 * @param { string | PushStream } [stream]
 * @returns { void }
 */
function destroyClients(stream) {
  if (stream === undefined) {
    for (const cacheKey of cache.keys()) {
      destroyClient(cacheKey);
    }
    return;
  }

  const { url } = getStream(stream);
  const cacheKey = getUrlCacheKey(getUrl(url));

  destroyClient(cacheKey);
}

/**
 * Destroy client at 'cacheKey'
 *
 * @param { string } cacheKey
 * @returns { void }
 * @private
 */
function destroyClient(cacheKey) {
  const clients = cache.get(cacheKey);

  if (clients !== undefined) {
    for (const client of clients) {
      client.removeAllListeners();
      client.close();
    }
    clients.clear();
    cache.delete(cacheKey);
  }
}

/**
 * Retrieve PushStream from 'stream'
 * If passed as string, will determine type from url
 *
 * @param { string | PushStream } stream
 * @returns { PushStream }
 * @private
 */
function getStream(stream) {
  if (typeof stream === 'string') {
    const url = getUrl(stream);
    const isWebSocket = isWebSocketUrl(url);

    stream = {
      url: url.href,
      type: isWebSocket ? 'ws' : 'es'
    };
  }

  return stream;
}
