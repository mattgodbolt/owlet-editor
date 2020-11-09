const path = require('path');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');

const isDev = process.env.NODE_ENV !== 'production';

function getPlugins() {
    const plugins = [
        new CopyPlugin({
            patterns: [
                {from: path.resolve(__dirname, 'node_modules/jsbeeb/roms'), to: 'jsbeeb/roms'},
                {from: path.resolve(__dirname, 'node_modules/jsbeeb/sounds'), to: 'jsbeeb/sounds'},
            ],
        }),
        new MonacoWebpackPlugin({
            languages: [],
            filename: isDev ? '[name].worker.js' : `[name].worker[contenthash].js`
        }),
        new MiniCssExtractPlugin({
            filename: isDev ? '[name].css' : '[name].[contenthash].css',
        }),
    ];
    if (isDev) {
        plugins.push(new webpack.HotModuleReplacementPlugin);
    }
    return plugins;
}

module.exports = {
    mode: 'development',
    entry: './src/index.js',
    output: {
        filename: isDev ? '[name].js' : `[name][contenthash].js`,
        path: path.resolve(__dirname, 'dist'),
    },
    resolve: {
        alias: {
            'jsunzip': path.resolve(__dirname, 'node_modules/jsbeeb/lib/jsunzip.js'),
            'fs': path.resolve(__dirname, 'src/fake-fs.js')
        },
        preferRelative: true, // ugly, for jsbeeb and its love of non-relative imports
    },
    devtool: 'source-map',
    plugins: getPlugins(),
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
                test: /\.less$/,
                use: [
                    isDev ? 'style-loader' :
                        {
                            loader: MiniCssExtractPlugin.loader,
                        },
                    'css-loader',
                    'less-loader'
                ]
            },
            {
                test: /\.css$/,
                use: [
                    isDev ? 'style-loader' :
                        {
                            loader: MiniCssExtractPlugin.loader,
                        },
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

