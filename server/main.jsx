import { checkNpmVersions } from 'meteor/tmeasday:check-npm-versions';
import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import logger from './logger';
import { perfStart, perfStop } from './perfMeasure';
import createDataContext from './dataContext';
import cache from './cache';

checkNpmVersions({
  react: '15.x',
  'react-dom': '15.x',
  express: '4.x',
  helmet: '3.x',
  'react-helmet': '3.x',
  'react-redux': '5.x',
}, 'ssrwpo:ssr');

/* eslint-disable import/no-mutable-exports, import/no-unresolved,
                  import/no-extraneous-dependencies,
                  import/no-mutable-exports */
const React = require('react');
const { renderToString, renderToStaticMarkup } = require('react-dom/server');
const express = require('express');
const helmet = require('helmet');
const { rewind } = require('react-helmet');
const { Provider } = require('react-redux');

// For debug purposes
let debugLastRequest = null;
let debugLastResponse = null;
/* eslint-enable */

let nextTick = fct => Meteor.defer(() => fct());
nextTick = Meteor.bindEnvironment(nextTick);

/* eslint-disable no-param-reassign */
const createRouter = (MainApp, store, ServerRouter, createServerRenderContext) => {
  // Create an Express server
  const app = express();
  // Secure Express
  app.use(helmet());
  // Create data context
  const { dataContext, dataMarkup } = createDataContext();
  // Avoid parsing "/api" URLs
  app.get(/^(?!\/api)/, (req, res, next) => {
    perfStart();
    debugLastRequest = req;
    debugLastResponse = res;
    const url = req.originalUrl;
    // Page is in the cache
    if (cache.has(url)) {
      logger.debug('Cache hit');
      const cached = cache.get(url);
      req.dynamicHead = cached.head;
      req.dynamicBody = cached.body;
      next();
      perfStop(url);
      return;
    }
    let head = null;
    let body = null;
    let hasCacheMissed = false;
    // Create application main entry point
    const routerContext = createServerRenderContext();
    let bodyMarkup = renderToString(
      <Provider store={store}>
        <ServerRouter location={url} context={routerContext}>
          <MainApp context={dataContext} />
        </ServerRouter>
      </Provider>,
    );
    // Get router results
    const routerResult = routerContext.getResult();
    // Redirect case
    if (routerResult.redirect) {
      logger.debug('Redirect');
      res.writeHead(301, { Location: routerResult.redirect.pathname });
      res.end();
      return;
    }
    // Not found, re-render for <Miss> component
    if (routerResult.missed) {
      // @TODO Cache 404 page
      req.res.statusCode = 404;
      req.res.statusMessage = 'Not found';
      // @NOTE There's an odd behavior while rerendering the app as depicted
      // in react-router docs. The client side does not compute the ID
      // properly leading to inconsistencies during the application re-hydratation.
      bodyMarkup = renderToStaticMarkup(
        <Provider store={store}>
          <ServerRouter location={url} context={routerContext}>
            <MainApp context={dataContext} />
          </ServerRouter>
        </Provider>,
      );
    } else {
      // Normal route, ask for caching
      hasCacheMissed = true;
    }
    logger.debug('Cache missed');
    logger.debug('Store initial state:', JSON.stringify(store.getState()));
    // Create body
    body = `<div id="react">${bodyMarkup}</div>${dataMarkup}`;
    // Create head
    const helmetHead = rewind();
    head = ['title', 'meta', 'link', 'script']
      .reduce((acc, key) => `${acc}${helmetHead[key].toString()}`, '');
    // Set response's head and body in Webapp's dynamic handlers
    req.dynamicHead = head;
    req.dynamicBody = body;
    // Next middleware
    next();
    // Cache value on next process tick if required
    if (hasCacheMissed) { nextTick(() => cache.set(url, head, body)); }
    perfStop(url);
  });
  // Add Express to Meteor's connect
  WebApp.connectHandlers.use(Meteor.bindEnvironment(app));
};

// Server side exports
export default createRouter;
export {
  logger,
  // For easing debug in `meteor shell`
  debugLastRequest, debugLastResponse,
};
