'use strict';

const { cleanBundles, destroyWorkers } = require('../lib/bundler/index.js');
const appServer = require('../lib/server/app-server.js');
const config = require('../lib/config.js');
const { expect } = require('chai');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

let server;

function changeBodyContent(content) {
  fs.writeFileSync(
    path.resolve('./body.js'),
    `module.exports = '${content}';\n`
  );
}

describe('appServer', () => {
  before(() => {
    process.chdir(path.resolve(__dirname, 'fixtures'));
  });
  afterEach(async () => {
    cleanBundles();
    server && (await server.destroy());
  });
  after(async () => {
    changeBodyContent('hi');
    process.chdir(path.resolve(__dirname, '..'));
    await destroyWorkers();
  });

  it('should start an app server', async () => {
    server = await appServer('app.js', { port: 8000 });
    const res = await fetch('http://localhost:8000/', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
    expect(res.status).to.eql(200);
    expect(await res.text()).to.contain('hi');
  });
  it('should start an app server listening for "request" event', async () => {
    server = await appServer('appListener.js', { port: 8000 });
    const res = await fetch('http://localhost:8000/', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
    expect(res.status).to.eql(200);
    expect(await res.text()).to.contain('ok');
  });
  it('should start an esm app server', async () => {
    server = await appServer('appEsm.js', { port: 8000 });
    const res = await fetch('http://localhost:8000/', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
    expect(res.status).to.eql(200);
    expect(await res.text()).to.contain('hi');
  });
  it('should trigger exit handlers for clean up', async () => {
    server = await appServer('appExit.js', { port: 8000 });
    expect(global.beforeExitCalled).to.equal(undefined);
    await server.restart();
    expect(global.beforeExitCalled).to.equal(true);
  });
  it.skip('should restart an app server on file change', (done) => {
    appServer('app.js', { port: 8000 }).then((s) => {
      server = s;
      changeBodyContent('bye');
    });
    setTimeout(async () => {
      const res = await fetch('http://localhost:8000/', {
        headers: { 'Content-Type': 'text/html' }
      });
      expect(await res.text()).to.contain('bye');
      done();
    }, 500);
  });
  it('should serve a bundled module js file', async () => {
    server = await appServer('app.js', { port: 8000 });
    const res = await fetch(
      `http://localhost:8000/${config.bundleDirName}/lodash__array-4.17.10.js`
    );
    expect(res.status).to.eql(200);
    const body = await res.text();
    expect(body).to.contain('function baseSlice');
    expect(body).to.contain('export default array;');
  });
  it('should serve a bundled module js file from server listening for "request" event', async () => {
    server = await appServer('appListener.js', { port: 8000 });
    const res = await fetch(
      `http://localhost:8000/${config.bundleDirName}/lodash__array-4.17.10.js`
    );
    expect(res.status).to.eql(200);
    const body = await res.text();
    expect(body).to.contain('function baseSlice');
    expect(body).to.contain('export default array;');
  });
  it('should serve a node_modules module js file', async () => {
    server = await appServer('app.js', { port: 8000 });
    const res = await fetch(`http://localhost:8000/node_modules/foo/foo.js`);
    expect(res.status).to.eql(200);
    const body = await res.text();
    expect(body).to.contain("console.log('this is foo')");
  });
  it('should pass requests through to app', async () => {
    server = await appServer('app.js', { port: 8000 });
    const res = await fetch(`http://localhost:8000/www/script.js`);
    expect(res.status).to.eql(200);
    expect(res.headers.get('x-app')).to.equal('test');
  });
});
