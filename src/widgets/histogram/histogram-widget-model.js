var WidgetModel = require('../widget-model');
var AutoStylerFactory = require('../auto-style/factory');
var _ = require('underscore');

/**
 * Model for a histogram widget
 */
module.exports = WidgetModel.extend({

  defaultState: _.extend(
    {
      autoStyle: false,
      normalized: false,
      min: function () {
        return this.dataviewModel.get('start');
      },
      max: function () {
        return this.dataviewModel.get('end');
      }
    },
    WidgetModel.prototype.defaultState
  ),

  initialize: function (attrs, opts) {
    WidgetModel.prototype.initialize.apply(this, arguments);
    this.autoStyler = AutoStylerFactory.get(this.dataviewModel);
    this.on('change:collapsed', this._onCollapsedChange, this);
    this.dataviewModel.once('change', function () {
      if (this.get('autoStyle')) {
        this.autoStyle();
      } else {
        this.autoStyler.set('palette', null);
      }
    }, this);
    this.dataviewModel.layer.bind('change:meta', function (model, style) {
      var ramp = style.match(/\[\s*?.*?[><=]\s*?\d*?\s*?\]\s*?\{\s*?.*?:\s*?#.*?;\s*?}/g);
      if (ramp.length > 1) {
        var bounds = ramp.map(function (el) {
          return {
            color: el.match(/#....../g)[0],
            upper_value: parseInt(el.match(/>.*?]/g)[0].replace(']', '').replace('>', ''), 10)
          };
        });
        this.autoStyler.set('palette', bounds);
      }
    });
  },

  _onCollapsedChange: function (m, isCollapsed) {
    this.dataviewModel.set('enabled', !isCollapsed);
  },

  autoStyle: function () {
    var layer = this.dataviewModel.layer;
    if (!layer.get('initialStyle')) {
      var initialStyle = layer.get('cartocss');
      if (!initialStyle && layer.get('meta')) {
        initialStyle = layer.get('meta').cartocss;
      }
      layer.set('initialStyle', initialStyle);
    }
    var style = this.autoStyler.getStyle();
    this.dataviewModel.layer.set('cartocss', style);
    this.set('autoStyle', true);
  },

  cancelAutoStyle: function () {
    this.dataviewModel.layer.restoreCartoCSS();
    this.autoStyler.set('palette', null);
    this.set('autoStyle', false);
  }

});
