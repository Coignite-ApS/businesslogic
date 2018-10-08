const path = require('path');
const glob = require("glob");
const webpack = require('webpack');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const package = require('./package.json');

/*
TODO: Support for integrity and crossorigin

https://www.srihash.org

<script
  src="https://code.jquery.com/jquery-3.3.1.js"
  integrity="sha256-2Kok7MbOyxpgUVvAk/HJ2jigOSYS2auK4Pfzbm7uH60="
  crossorigin="anonymous"></script>


 */

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
        // Theme files
        './themes/businesslogic-standard-theme.scss',
        //'./themes/businesslogic-elegant-theme.scss',
        // Main files
        './src/index.ts'
    ],
    //devtool: 'inline-source-map',
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
                        loader: 'css-loader',
                        options: {
                            minimize: true,
                            //sourceMap: true,
                            importLoaders: 2
                        }

                    },
                    {
                        loader: 'postcss-loader'
                    },
                    {
                        loader: 'sass-loader'
                    }
                ],
                exclude: /node_modules/
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
        filename: package.name + '.' + package.version + '.js',
        library: 'Businesslogic',
        libraryTarget: 'umd',
        umdNamedDefine: true
    }
};