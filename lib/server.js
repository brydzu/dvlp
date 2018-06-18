'use strict';

const { exists, getProjectPath, importModule } = require('./utils/file');
const config = require('./config');
const { destroyWorkers } = require('./utils/moduleBundler');
const { info } = require('./utils/log');
const appServer = require('./appServer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const reloadServer = require('./reloadServer');
const staticServer = require('./staticServer');

/**
 * Create server
 * @param {string|[string]} filepath
 * @param {{ port: number, reload: boolean, rollupConfig: string, transpiler: string }} [options]
 * @returns {Promise<{ destroy: () => void }>}
 */
module.exports = async function server(
  filepath = process.cwd(),
  { port = config.port, reload = true, rollupConfig, transpiler } = {}
) {
  exists(filepath);

  let reloader, server;

  if (rollupConfig) {
    const configpath = path.resolve(rollupConfig);

    rollupConfig = importModule(configpath).default;
    info(
      `${chalk.green('✔')} registered custom Rollup.js config at ${chalk.green(
        getProjectPath(configpath)
      )}`
    );
  }
  if (transpiler) {
    const transpilerpath = path.resolve(transpiler);

    transpiler = importModule(transpilerpath).default;
    info(
      `${chalk.green('✔')} registered transpiler at ${chalk.green(getProjectPath(transpilerpath))}`
    );
  }
  if (reload) {
    reloader = await reloadServer();
  }

  if (Array.isArray(filepath) || fs.statSync(path.resolve(filepath)).isDirectory()) {
    server = await staticServer(filepath, { port, reloader, rollupConfig, transpiler });
  } else {
    server = await appServer(filepath, { port, reloader, rollupConfig, transpiler });
  }

  info('👀 watching for changes...\n');

  return {
    destroy() {
      return Promise.all([reloader && reloader.destroy(), server.destroy(), destroyWorkers()]);
    }
  };
};
