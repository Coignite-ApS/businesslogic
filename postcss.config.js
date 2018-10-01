// Consider other plugins https://github.com/postcss/postcss#plugins
module.exports = {
    map: 'inline',
    plugins: [
        require('autoprefixer'),
        require('postcss-preset-env')
    ]
}