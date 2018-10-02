// Consider other plugins https://github.com/postcss/postcss#plugins
module.exports = {
    syntax: 'postcss-scss',
    map: true,
    plugins: [
        /*
        require('stylelint')({
            extends: 'stylelint-config-standard',
            rules: {
                "block-opening-brace-newline-before": "always"
            }
        }),
        */
        require("postcss-reporter")({ clearReportedMessages: true }),
        require('autoprefixer'),
        require('postcss-preset-env'),
        require('cssnano')({
            preset: 'default'
        })
    ]
};