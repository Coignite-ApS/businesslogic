const path = require('path');
const glob = require("glob");
const webpack = require('webpack');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const libraryName = 'businesslogic';
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
    entry: [
        './src/index.ts',
        glob.sync("./test/**/*.css")
    ],
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
            },
            {
                test: /\.scss$/,
                use: [
                    {
                        loader: 'file-loader',
                        options: {
                            name: '[name].css'
                        }
                    },
                    {
                        loader: 'extract-loader'
                    },
                    {
                        loader: 'css-loader'
                    },
                    {
                        loader: 'postcss-loader'
                    },
                    {
                        loader: 'sass-loader'
                    }
                ]
            }
        ]
    },
    plugins: [
        new webpack.BannerPlugin(banner)
    ],
    resolve: {
        extensions: [ '.tsx', '.ts', '.js', '.scss', '.css' ]
    },
    output: {
        path: path.resolve(__dirname, 'lib'),
        filename: libraryName + '.js',
        library: libraryName,
        libraryTarget: 'umd',
        umdNamedDefine: true
    }
};