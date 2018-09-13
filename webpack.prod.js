const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const webpack = require('webpack');
const CleanWebpackPlugin = require('clean-webpack-plugin');

// TODO: Consider using https://github.com/webpack-contrib/closure-webpack-plugin

module.exports = merge(common, {
    mode: 'production',
    plugins: [
        new CleanWebpackPlugin(['lib'])
    ]
});
