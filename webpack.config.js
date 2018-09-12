var webpack = require('webpack'),
    path = require('path');


// Webpack Config
var webpackConfig = {
    entry: {
        'app': './src/app.ts',
    },

    resolve: {
        root: [path.join(__dirname, 'src')],
        extensions: ['', '.ts', '.js'],
        alias: {
        },
        node: {
            global: 1,
            crypto: 'empty',
            module: 0,
            Buffer: 0,
            clearImmediate: 0,
            setImmediate: 0
        }
    },

    devtool: 'cheap-module-source-map',
    cache: true,
    debug: true,


    output: {
        path: __dirname + '/dist',
        filename: '[name].bundle.js',
        sourceMapFilename: '[name].map',
    },

    plugins: [
        new webpack.optimize.CommonsChunkPlugin({ name: ['app'], minChunks: Infinity }),
    ],

    module: {
        loaders: [
            // .ts files for TypeScript
            {
                test: /\.ts$/,
                loader: 'awesome-typescript-loader'
            },
            {
                test: /\.js$/,
                loader: 'source-map-loader',
                exclude: [
                ]
            },
            {
                test: /\.scss$/,
                loaders: ["style", "css?sourceMap", "sass?sourceMap"]
            }
        ]
    }

};

module.exports = webpackConfig;

