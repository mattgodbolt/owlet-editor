const path = require('path');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const OptimizeCssAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');

const isDev = process.env.NODE_ENV !== 'production';

function getPlugins() {
    const plugins = [
        new CleanWebpackPlugin(),
        new CopyPlugin({
            patterns: [
                {
                    context: path.resolve(__dirname, 'node_modules'), from: 'jsbeeb/roms/**/*',
                    globOptions: {ignore: ['**/*.txt', '**/*README*']}
                },
                {context: path.resolve(__dirname, 'node_modules'), from: 'jsbeeb/sounds/**/*.wav'},
            ],
        }),
        new MonacoWebpackPlugin({
            languages: [],
            filename: isDev ? '[name].worker.js' : `[name].worker.[contenthash].js`
        }),
        new MiniCssExtractPlugin({
            filename: isDev ? '[name].css' : '[name].[contenthash].css',
        }),
        new HtmlWebpackPlugin({
            title: 'Owlet Editor',
        }),
    ];
    if (isDev) {
        plugins.push(new webpack.HotModuleReplacementPlugin);
    }
    return plugins;
}

module.exports = {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.js',
    output: {
        filename: isDev ? '[name].js' : `[name].[contenthash].js`,
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
        minimize: !isDev,
        runtimeChunk: 'single',
        splitChunks: {
            cacheGroups: {
                vendors: {
                    test: /[/\\]node_modules[/\\]/,
                    name: 'vendor',
                    chunks: 'all',
                    priority: -10,
                },
            },
        },
        moduleIds: 'deterministic',
        minimizer: [
            new OptimizeCssAssetsPlugin({
                cssProcessorPluginOptions: {
                    preset: ['default', {discardComments: {removeAll: true}}],
                },
            }),
            new TerserPlugin(),
        ],
    },
    module: {
        rules: [
            {
                test: /\.(jpg|png)$/,
                use: {
                    loader: 'url-loader',
                },
            },
            {
                test: /\.less$/,
                use: [
                    isDev ? 'style-loader' :
                        {
                            loader: MiniCssExtractPlugin.loader,
                            options: {
                                publicPath: './',
                            },
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
                            options: {
                                publicPath: './',
                            },
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
            {
                test: /\.ya?ml$/,
                use: ['json-loader', 'yaml-loader']
            }
        ],
    }
};
