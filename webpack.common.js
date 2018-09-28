const path = require('path');
const webpack = require('webpack');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const libraryName = 'businesslogic';
const outputFile = libraryName + '.js';
const package = require('./package.json');

var banner =
    package.name + '\n' +
    'version ' + package.version + '\n' +
    '------------------------------------ ' + '\n' +
    package.description + '\n' +
    '------------------------------------ ' + '\n' +
    '' + '\n' +
    'Rassvet ApS, https://rassvet.co' + '\n' +
    'Public domain.' + '\n' +
    'NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.';

module.exports = {
    entry: './src/index.ts',
    devtool: 'inline-source-map',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: [
                    { loader: 'strip-whitespace-loader' },
                    { loader: 'ts-loader' }
                    ],
                exclude: /node_modules/
            }
        ]
    },
    plugins: [
        new webpack.BannerPlugin(banner)
    ],
    resolve: {
        extensions: [ '.tsx', '.ts', '.js' ]
    },
    output: {
        path: path.resolve(__dirname, 'lib'),
        filename: outputFile,
        library: libraryName,
        libraryTarget: 'umd',
        umdNamedDefine: true
    }
};