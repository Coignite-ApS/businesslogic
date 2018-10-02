const path = require('path');
const glob = require("glob");
const webpack = require('webpack');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
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

var entries = ['./src/index.ts'];

var themes = [
    'businesslogic-standard-theme',
    //'businesslogic-elegant-theme'
];

for(var theme in themes) {
    if(themes.hasOwnProperty(theme)) {
        entries.push('./themes/' + themes[theme] + '.scss')
    }
}

module.exports = {
    entry: entries,
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
                        loader: 'css-loader',
                        options: {
                            minimize: true,
                            sourceMap: true,
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
        library: package.name,
        libraryTarget: 'umd',
        umdNamedDefine: true
    }
};