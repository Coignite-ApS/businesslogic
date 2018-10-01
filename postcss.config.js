// Consider other plugins https://github.com/postcss/postcss#plugins
module.exports = {
    syntax: 'postcss-scss',
    map: { inline: true },
    plugins: [
        require('autoprefixer'),
        require('postcss-preset-env'),
        require('cssnano')({
            preset: 'default'
        })
    ]
};