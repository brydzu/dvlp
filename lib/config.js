'use strict';

const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');

const TESTING = process.env.NODE_ENV === 'test';
// Prevent parallel test runs from reading from same cache
const DIR = `.dvlp${TESTING ? process.getuid() : ''}`;
const VERSION = process.env.DVLP_VERSION;

const dir = path.resolve(DIR);
const bundleDirName = `${path.join(DIR, `bundle-${VERSION}`)}`;
const bundleDir = path.resolve(bundleDirName);
const maxModuleBundlerWorkers = parseInt(process.env.BUNDLE_WORKERS, 10) || 0;
const port = process.env.PORT ? Number(process.env.PORT) : 8080;

// Work around rollup-plugin-commonjs require.main.filename
if (TESTING || process.env.DVLP_LAUNCHER === 'cmd') {
  const bundleDirExists = fs.existsSync(bundleDir);
  const dirExists = fs.existsSync(dir);
  const rm = dirExists && !bundleDirExists;

  if (rm) {
    const contents = fs.readdirSync(dir).map((item) => path.resolve(dir, item));

    for (const item of contents) {
      // Delete all subdirectories
      if (fs.statSync(item).isDirectory()) {
        rimraf.sync(item);
      }
    }
  }
  if (!dirExists) {
    fs.mkdirSync(dir);
  }
  if (!bundleDirExists) {
    fs.mkdirSync(bundleDir);
  }

  if (TESTING) {
    process.on('exit', () => {
      rimraf.sync(dir);
    });
  }
}

/**
 * @typedef { object } Config
 * @property { number } activePort,
 * @property { string } bundleDir,
 * @property { string } bundleDirName,
 * @property { Array<string> } directories,
 * @property { object } extensionsByType,
 * @property { Array<string> } extensionsByType.css,
 * @property { Array<string> } extensionsByType.html,
 * @property { Array<string> } extensionsByType.js,
 * @property { number } latency,
 * @property { string } maxAge,
 * @property { number } maxModuleBundlerWorkers,
 * @property { number } port,
 * @property { string } testing,
 * @property { object } typesByExtension,
 * @property { object } typesByExtension,
 */
module.exports = {
  activePort: port,
  bundleDir,
  bundleDirName,
  directories: [process.cwd()],
  extensionsByType: {
    css: ['.css', '.sass', '.scss', '.less', '.styl', '.stylus'],
    html: [
      '.html',
      '.htm',
      '.nunjs',
      '.nunjucks',
      '.hbs',
      '.handlebars',
      '.dust'
    ],
    js: ['.js', '.mjs', '.jsx', '.ts', '.tsx', '.json']
  },
  latency: 50,
  maxAge: '10m',
  maxModuleBundlerWorkers,
  port,
  rollupConfigPath: path.join(dir, 'rollup.config.js'),
  testing: TESTING,
  typesByExtension: {
    '.sass': 'css',
    '.scss': 'css',
    '.less': 'css',
    '.styl': 'css',
    '.stylus': 'css',
    '.html': 'html',
    '.htm': 'html',
    '.nunjs': 'html',
    '.nunjucks': 'html',
    '.hbs': 'html',
    '.handlebars': 'html',
    '.dust': 'html',
    '.mjs': 'js',
    '.json': 'js',
    '.jsx': 'js',
    '.ts': 'js',
    '.tsx': 'js'
  }
};
