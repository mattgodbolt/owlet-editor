const path = require('path');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const isDev = true;

module.exports = {
    mode: 'development',
    entry: './src/index.js',
    output: {
        filename: isDev ? '[name].js' : `[name][contenthash].js`,
        path: path.resolve(__dirname, 'dist'),
    },
    devtool: 'source-map',
    plugins: [
        new MonacoWebpackPlugin({
            languages: [],
            filename: isDev ? '[name].worker.js' : `[name].worker[contenthash].js`
        })
    ],
    devServer: {
        publicPath: '/',
        contentBase: './'
    },
    optimization: {
        // Enabling any of this stuff from CE breaks things silently
        // splitChunks: {
        //     cacheGroups: {
        //         vendors: {
        //             test: /[/\\]node_modules[/\\]/,
        //             name: 'vendor',
        //             chunks: 'all',
        //             priority: -10,
        //         },
        //     },
        // },
        moduleIds: 'deterministic',
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader',
                ],
            }, {
                test: /\.ttf$/,
                use: ['file-loader']
            },
            {
                test: /\.(html)$/,
                loader: 'html-loader',
            },
        ],
    }
};

