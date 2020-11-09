const path = require('path');

module.exports = {
    entry: './src/index.js',
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist'),
    },
    devServer: {
        publicPath: '/dist',
        contentBase: './'
    },
    module: {
        rules: [
            {
                test: /\.(html)$/,
                loader: 'html-loader',
            },
        ],
    }
};

