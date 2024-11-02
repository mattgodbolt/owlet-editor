const path = require("path");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const {CleanWebpackPlugin} = require("clean-webpack-plugin");
const FaviconsWebpackPlugin = require("favicons-webpack-plugin");
const glob = require("glob");
const HtmlWebpackPartialsPlugin = require("html-webpack-partials-plugin");

const isDev = process.env.NODE_ENV !== "production";
const isTest = process.env.TESTBUILD !== undefined;

const entry = isTest
    ? glob.sync(path.resolve(__dirname, "test/**/*.js")).sort()
    : path.resolve(__dirname, "./src/index.js");
const outputPath = isTest ? path.resolve(__dirname, "dist/test") : path.resolve(__dirname, "dist");

function getOptimizationSettings() {
    if (isTest) return undefined;
    return {
        minimize: !isDev,
        minimizer: [new CssMinimizerPlugin(), new TerserPlugin()],
    };
}

function getPlugins() {
    const plugins = [
        new CleanWebpackPlugin(),
        new CopyPlugin({
            patterns: [
                {
                    context: path.resolve(__dirname, "node_modules"),
                    from: "jsbeeb/roms/**/*",
                    globOptions: {ignore: ["**/*.txt", "**/*README*"]},
                },
                {
                    context: path.resolve(__dirname, "node_modules"),
                    from: "jsbeeb/sounds/**/*.wav",
                },
            ],
        }),
        new MonacoWebpackPlugin({
            languages: [],
            filename: isDev ? "[name].worker.js" : `[name].worker.[contenthash].js`,
        }),
        new MiniCssExtractPlugin({
            filename: isDev ? "[name].css" : "[name].[contenthash].css",
        }),
        new HtmlWebpackPlugin({
            title: "Owlet BBC BASIC Editor",
        }),
        new HtmlWebpackPartialsPlugin([
            {
                path: path.resolve(__dirname, "src", "analytics.html"),
                location: "head",
                priority: "high",
            },
        ]),
        new FaviconsWebpackPlugin({
            logo: "./assets/images/owlet.png",
            prefix: "assets/images/",
            favicons: {
                icons: {
                    appleIcon: false,
                    appleStartup: false,
                },
            },
        }),
    ];
    if (isTest) {
        plugins.push(
            new CopyPlugin({
                patterns: [
                    {
                        context: path.resolve(
                            __dirname,
                            "node_modules",
                            "canvas",
                            "build",
                            "Release",
                        ),
                        from: "*.so*",
                    },
                ],
            }),
        );
    }
    return plugins;
}

module.exports = {
    mode: isDev ? "development" : "production",
    entry: entry,
    target: isTest ? "node" : "web",
    // In test, work around the fact bufferutil and utf-8-validate don't really exist
    externals: isTest ? ["bufferutil", "utf-8-validate"] : [],
    output: {
        filename: isDev ? "[name].js" : `[name].[contenthash].js`,
        path: outputPath,
    },
    resolve: {
        alias: {
            jsunzip: path.resolve(__dirname, "node_modules/jsbeeb/lib/jsunzip.js"),
            fs: path.resolve(__dirname, "src/fake-fs.js"),
        },
        preferRelative: true, // ugly, for jsbeeb and its love of non-relative imports
    },
    devtool: "source-map",
    plugins: getPlugins(),
    devServer: {
        hot: isDev,
        static: {
            publicPath: "/",
            directory: "./",
        },
    },
    optimization: getOptimizationSettings(),
    module: {
        rules: [
            {
                test: /\.(jpg|png)$/,
                type: "asset/inline",
            },
            {
                test: /\.less$/,
                use: [
                    isDev
                        ? "style-loader"
                        : {
                              loader: MiniCssExtractPlugin.loader,
                              options: {
                                  publicPath: "./",
                              },
                          },
                    "css-loader",
                    "less-loader",
                ],
            },
            {
                test: /\.css$/,
                use: [
                    isDev
                        ? "style-loader"
                        : {
                              loader: MiniCssExtractPlugin.loader,
                              options: {
                                  publicPath: "./",
                              },
                          },
                    "css-loader",
                ],
            },
            {
                test: /\.ttf$/,
                type: "asset/resource",
            },
            {
                test: /\.(html)$/,
                loader: "html-loader",
            },
            {
                test: /\.ya?ml$/,
                use: ["yaml-loader"],
            },
            {
                test: /.rom$/i,
                use: ["binary-loader"],
            },
            {
                test: /\.node$/,
                loader: "node-loader",
            },
        ],
    },
};
