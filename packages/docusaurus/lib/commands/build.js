/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const webpack = require('webpack');
const merge = require('webpack-merge');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');
const path = require('path');
const chalk = require('chalk');
const fs = require('fs-extra');
const globby = require('globby');
const load = require('../server/load');
const createServerConfig = require('../webpack/server');
const createClientConfig = require('../webpack/client');
const {applyConfigureWebpack} = require('../webpack/utils');

function compile(config) {
  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      if (err) {
        reject(err);
      }
      if (stats.hasErrors()) {
        stats.toJson().errors.forEach(e => {
          console.error(e);
        });
        reject(new Error('Failed to compile with errors.'));
      }
      if (stats.hasWarnings()) {
        stats.toJson().warnings.forEach(warning => {
          console.warn(warning);
        });
      }
      resolve(stats.toJson({modules: false}));
    });
  });
}

module.exports = async function build(siteDir, cliOptions = {}) {
  process.env.NODE_ENV = 'production';
  console.log(chalk.blue('Creating an optimized production build...'));

  const props = await load(siteDir, cliOptions);

  // Apply user webpack config.
  const {outDir, plugins} = props;

  let clientConfig = merge(createClientConfig(props), {
    plugins: [
      // Remove/clean build folders before building bundles.
      new CleanWebpackPlugin({verbose: false}),
      // Visualize size of webpack output files with an interactive zoomable treemap.
      cliOptions.bundleAnalyzer && new BundleAnalyzerPlugin(),
    ].filter(Boolean),
  });

  let serverConfig = createServerConfig(props);

  // Plugin lifecycle - configureWebpack
  plugins.forEach(plugin => {
    const {configureWebpack} = plugin;
    if (!configureWebpack) {
      return;
    }
    clientConfig = applyConfigureWebpack(
      configureWebpack.bind(plugin), // The plugin lifecycle may reference `this`.
      clientConfig,
      false,
    );
    serverConfig = applyConfigureWebpack(
      configureWebpack.bind(plugin), // The plugin lifecycle may reference `this`.
      serverConfig,
      true,
    );
  });

  // Build the client bundles first.
  // We cannot run them in parallel because the server needs to know
  // the correct client bundle name.
  await compile(clientConfig);

  // Build the server bundles (render the static HTML and pick client bundle),
  await compile(serverConfig);

  // Copy static files.
  const staticDir = path.resolve(siteDir, 'static');
  const staticFiles = await globby(['**'], {
    cwd: staticDir,
  });
  await Promise.all(
    staticFiles.map(async source => {
      const fromPath = path.resolve(staticDir, source);
      const toPath = path.resolve(outDir, source);
      return fs.copy(fromPath, toPath);
    }),
  );

  /* Plugin lifecycle - postBuild */
  await Promise.all(
    plugins.map(async plugin => {
      if (!plugin.postBuild) {
        return;
      }
      await plugin.postBuild(props);
    }),
  );

  const relativeDir = path.relative(process.cwd(), outDir);
  console.log(
    `\n${chalk.green('Success!')} Generated static files in ${chalk.cyan(
      relativeDir,
    )}.\n`,
  );
};
