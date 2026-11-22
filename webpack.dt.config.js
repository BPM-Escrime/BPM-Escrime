// Vue DT dans un navigateur (#1981 lot 3, docs/adr/0020) : entrée `dt`, cible web, servie par le
// serveur distant sous /dt/ (coquille HTML en mémoire : src/main/remote/dtView.ts, DT_PAGE_HTML).
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const production = process.env.NODE_ENV === 'production';

module.exports = {
  mode: production ? 'production' : 'development',
  cache: production ? false : { type: 'filesystem', buildDependencies: { config: [__filename] } },
  entry: { dt: './src/renderer/dt/index.tsx' },
  target: 'web',
  devtool: production ? false : 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist/remote/dt'),
    publicPath: '/dt/',
    filename: '[name].js',
    chunkFilename: '[name].chunk.js',
    clean: true,
  },
  optimization: {
    minimize: production,
    minimizer: [new TerserPlugin({ terserOptions: { compress: { drop_console: true } } })],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            ignoreDiagnostics: [5011, 5103],
            compilerOptions: { module: 'esnext', moduleResolution: 'bundler' },
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin({ filename: '[name].css' })],
  stats: { warnings: false },
};
