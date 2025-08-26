const rules = require('./webpack.rules');

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

module.exports = {
  resolve: {
    fallback: {
      path: require.resolve('path-browserify'),
      fs: false, // Disable fs in renderer
    },
  },
};
