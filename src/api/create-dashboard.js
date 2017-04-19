var _ = require('underscore');
var cdb = require('cartodb.js');
var Dashboard = require('./dashboard');
var DashboardView = require('../dashboard-view');
var WidgetsCollection = require('../widgets/widgets-collection');
var WidgetsService = require('../widgets-service');
var URLHelper = require('./url-helper');
var layerArray = [];
var layerssum = 0;
/**
 * Translates a vizJSON v3 datastructure into a working dashboard which will be rendered in given selector.
 *
 * @param {String} selector e.g. "#foobar-id", ".some-class"
 * @param {Object} vizJSON JSON datastructure
 * @param {Object} opts (Optional) flags, see 3rd param for cdb.createVis for available ones. Keys used here:
 *   renderMenu: {Boolean} If true (default), render a top-level menu on the left side.
 * @return {Object} with keys:
 *   dashboardView: root (backbone) view of the dashboard
 *   vis: the instantiated vis map, same result as given from cdb.createVis()
 */
var createDashboard = function (selector, vizJSON, opts, callback) {
  var dashboardEl = document.querySelector(selector);
  if (!dashboardEl) throw new Error('no element found with selector ' + selector);

  // Default options
  opts = opts || {};
  opts.renderMenu = _.isBoolean(opts.renderMenu)
    ? opts.renderMenu
    : true;
  opts.autoStyle = _.isBoolean(opts.autoStyle)
    ? opts.autoStyle
    : false;

  var widgets = new WidgetsCollection();

  var model = new cdb.core.Model({
    title: vizJSON.title,
    description: vizJSON.description,
    updatedAt: vizJSON.updated_at,
    userName: vizJSON.user.fullname,
    userProfileURL: vizJSON.user.profile_url,
    userAvatarURL: vizJSON.user.avatar_url,
    renderMenu: opts.renderMenu,
    autoStyle: opts.autoStyle,
    showLogo: opts.cartodb_logo,
    initialPosition: {
      bounds: vizJSON.bounds
    }
  });
  var dashboardView = new DashboardView({
    el: dashboardEl,
    widgets: widgets,
    model: model
  });
  var stateFromURL = opts.state || URLHelper.getStateFromCurrentURL();
  if (stateFromURL && !_.isEmpty(stateFromURL.map)) {
    if (stateFromURL.map.ne && stateFromURL.map.sw) {
      vizJSON.bounds = [stateFromURL.map.ne, stateFromURL.map.sw];
    }
  }

  var vis = cdb.createVis(dashboardView.$('#map'), vizJSON, _.extend(opts, {
    skipMapInstantiation: true
  }));

  
  vis.once('load', function (vis) {
    const ISNOTEMBED = (typeof userData != 'undefined') ? true : false;
    const USERLOCATION = (ISNOTEMBED) ? userData.username : vizJSON.datasource.user_name;
    const APIKEY = (ISNOTEMBED) ? opts.apiKey : 'bca011f4b203f67752e9b687c0bbec543fee23b7'; //beta dev user hardcoded, force it to expire when in doubt
    var _rasterConfig = function (layername) {
      return {
        "version": "1.3.1",
        "layers": [
          {
            "type": "cartodb",
            "options": {
              "sql": `SELECT * FROM ${layername}`,
              "cartocss": "#" + layername + " {raster-opacity: 0.5;}",
              "cartocss_version": "2.3.0",
              "geom_column": "the_raster_webmercator",
              "geom_type": "raster",
            }
          }
        ]
      }
    }
    var _renderTile = function(url) {
      vis.map.createTileLayer({"urlTemplate" : url, "opacity" : 0.5});
    }

    var _renderRaster = function(layername) {

      function _currentEndpoint() {
        return '//' + location.hostname + '/user/' + USERLOCATION + '/api/v1/map';
      }
      
      var config = _rasterConfig(layername);
    
      var request = new XMLHttpRequest();
      request.open('POST', _currentEndpoint()+`?api_key=${APIKEY}`, true);
      request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
      request.onload = function() {
        if (this.status >= 200 && this.status < 400) {
          var layergroup = JSON.parse(this.response);

          var tilesEndpoint = _currentEndpoint() + '/' + layergroup.layergroupid + '/{z}/{x}/{y}.png';

          var protocol = 'https:' == document.location.protocol ? 'https' : 'http';
          if (layergroup.cdn_url && layergroup.cdn_url[protocol]) {
            var domain = layergroup.cdn_url[protocol];
            if ('http' === protocol) {
                domain = '{s}.' + domain;
            }
            tilesEndpoint = protocol + '://' + domain + '/' + USERLOCATION + '/api/v1/map/' + layergroup.layergroupid + '/{z}/{x}/{y}.png';
          }

          rasterLayer = L.tileLayer(tilesEndpoint, {
              maxZoom: 18
          }).addTo(vis.map);
        } else {
            throw 'Error fetching raster: ' + this.status + ' -> ' + this.response;
        }
      };
      request.send(JSON.stringify(config));
    }
    let   visid = location.pathname.split('/');
    visid = (ISNOTEMBED)? visid[visid.length - 1] : visid[visid.length - 2];

    //check for tileo_layers_collection
    fetch(`//${location.hostname}/user/${USERLOCATION}/api/v2/sql?q=SELECT * FROM tileo_layers_collection WHERE visible = true AND vis LIKE '${visid}';&api_key=${APIKEY}`)
      .then(
      function(response) {  
        if (response.status !== 200) {  
          // the user has not created the tileo_layers_collection table
          // let's create that table
          fetch(`//${location.hostname}/user/${USERLOCATION}/api/v2/sql?q=CREATE TABLE tileo_layers_collection (tileo_layer_url TEXT, vis TEXT, layername TEXT, is_layer_geotiff BOOLEAN, visible BOOLEAN);&api_key=${APIKEY}`)
            .then(
              function(response) {
                console.info('tileo_layers_collection created, updating...');
                fetch(`//${location.hostname}/user/${USERLOCATION}/api/v2/sql?q=SELECT cdb_cartodbfytable('tileo_layers_collection');&api_key=${APIKEY}`)
                .then(
                  function(response) {
                    console.info('...updated');
                  }
                )
              }
            )
        } else {
          response.json().then(function(data) {
            if (ISNOTEMBED) {
              var list = document.querySelector('.raster-tiled-layers-content ul');
            }
            
            data.rows.forEach(function(row, i){
              const LAYERNAME = row.layername;
              ISNOTEMBED && list.appendChild(_paintLine(LAYERNAME, row.tileo_layer_url, i));

              if (!row.is_layer_geotiff) {   // tileset
                console.info('...tileset layer going in');
                _renderTile(row.tileo_layer_url);
              } else {                      // raster
                console.info('...raster layer going in');
                _renderRaster(LAYERNAME);
              }
            })
          });
        }
      }  
    )  
    .catch(function(err) {  
      console.error('Error fetching SQL API', err);  
    });

    var _paintBox = function() {
      var tilebox = document.querySelectorAll('.Editor-ListLayer li');
      if (!tilebox.length) return false;

      tilebox = tilebox[tilebox.length - 1];
      const BOXTOP = tilebox.offsetTop + tilebox.offsetHeight + 125 + 'px'; /*125px header height*/
      document.querySelector('.Editor-ListLayer-item-raster').style.top = BOXTOP;
    }
    ISNOTEMBED && _paintBox();

    var _paintLine = function(name, value, index) {
      let listitem = document.createElement('li');
      listitem.innerHTML = name + `<span class="remove-tiled-layer" data-tiledlayer="${value}" data-layerindex="${index + 1}"> 🗑</span>`;
      return listitem;
    }
    if (ISNOTEMBED) {
      document.querySelectorAll('.raster-tiled-layers-content button')[0].onclick = function (ev) {
        let layerInput = this.previousSibling.previousSibling;

        if (!layerInput.value) {
          let elem = document.getElementById('message-raster-layer');
          elem.innerHTML = 'Please type a URL or enter "GeoTIFF"';
          elem.style.display = 'inline-block';
          elem.classList.add('error');
          return;
        }
        let layername = '';
        let is_layer_geotiff = false;

        const VALIDURL = /\b((?:https?:\/\/|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/i;

        if (layerInput.value.toUpperCase().includes('TIFF') || !VALIDURL.exec(layerInput.value)){
          layername = layerInput.value;
          is_layer_geotiff = true;
        } else if (layerInput.value.toUpperCase().includes('NDVI')){
          layername = 'NDVI';
        } else if (layerInput.value.toUpperCase().includes('NDRE')){
          layername = 'NDRE';
        } else if (layerInput.value.toUpperCase().includes('THLA')){
          layername = 'THLA';
        } else if (layerInput.value.toUpperCase().includes('RGB')){
          layername = 'RGB';
        } 
        if (!is_layer_geotiff && (!layername || confirm('Layer name: '+ layername + ', change it?'))) {
          layername = prompt('Give this layer a name');
          layername = (!!layername) ? layername : 'Layer';
        }

        let newlayer = new L.TileLayer(layerInput.value);
        let layerindex = layerArray.length +1;
        layerArray.push([newlayer]);
        if (is_layer_geotiff) {
          _renderRaster(layername);
        } else {
          _renderTile(layerInput.value);
        }

        let listitem = document.createElement('li');
        ev.target.parentElement.parentElement.lastElementChild.appendChild(_paintLine(layername, layerInput.value, layerindex));

        //Upsert value ()
        const QUERY = `
        UPDATE tileo_layers_collection
        SET vis = '${visid}', layername = '${layername}', tileo_layer_url = '${encodeURIComponent(layerInput.value)}', is_layer_geotiff = '${is_layer_geotiff}', visible = true
        WHERE vis like '${visid}' AND layername = '${layername}';

        BEGIN;
          LOCK TABLE tileo_layers_collection IN SHARE ROW EXCLUSIVE MODE;
          INSERT INTO tileo_layers_collection (vis, tileo_layer_url, visible, layername, is_layer_geotiff)
          SELECT '${visid}','${encodeURIComponent(layerInput.value)}', true, '${layername}', '${is_layer_geotiff}'
          WHERE NOT EXISTS (SELECT 1 FROM tileo_layers_collection WHERE vis LIKE '${visid}' AND layername = '${layername}');
        COMMIT;
        `;
        fetch(`//${location.hostname}/user/${USERLOCATION}/api/v2/sql?q=${QUERY};&api_key=${APIKEY}`)
        .then(
          function(response) {
            if (response.status == 200) {return console.info('table updated')}
            console.error('error while updating the table')
          }
        );
      }

      document.querySelector('body').addEventListener('click', function(event) {
        if (document.querySelectorAll('ul.CDB-NavMenu-inner li')[0].classList.contains('is-selected')) {
          _paintBox();
          document.querySelector('.Editor-ListLayer-item-raster').style.display = 'block';
        } else {
          document.querySelector('.Editor-ListLayer-item-raster').style.display = 'none';
        }

        if (event.target.classList.contains('remove-tiled-layer') && confirm('delete layer?')) {
          vis.map.removeLayerAt(event.target.dataset.layerindex);
          event.target.parentElement.remove();

          //hide on DB
          const QUERY = `
          UPDATE tileo_layers_collection SET visible = false WHERE tileo_layer_url LIKE '${encodeURIComponent(event.target.dataset.tiledlayer)}' AND vis like '${visid}';
          `;
          fetch(`//${location.hostname}/user/${USERLOCATION}/api/v2/sql?q=${QUERY};&api_key=${APIKEY}`);
        }
      });
    }

    if (stateFromURL && !_.isEmpty(stateFromURL.map)) {
      if (!_.isUndefined(stateFromURL.map.ne) && !_.isUndefined(stateFromURL.map.sw)) {
        vis.map.setBounds([stateFromURL.map.ne, stateFromURL.map.sw]);
      } else if (!_.isUndefined(stateFromURL.map.center) && !_.isUndefined(stateFromURL.map.zoom)) {
        vis.map.setView(stateFromURL.map.center, stateFromURL.map.zoom);
      }
    }

    var widgetsState = stateFromURL && stateFromURL.widgets || {};

    // Create widgets
    var widgetsService = new WidgetsService(widgets, vis.dataviews);
    var widgetModelsMap = {
      list: widgetsService.createListModel.bind(widgetsService),
      formula: widgetsService.createFormulaModel.bind(widgetsService),
      histogram: widgetsService.createHistogramModel.bind(widgetsService),
      'time-series': widgetsService.createTimeSeriesModel.bind(widgetsService),
      category: widgetsService.createCategoryModel.bind(widgetsService)
    };
    vizJSON.widgets.forEach(function (d) {
      // Flatten the data structure given in vizJSON, the widgetsService will use whatever it needs and ignore the rest
      var attrs = _.extend({}, d, d.options);
      var newWidgetModel = widgetModelsMap[d.type];
      var state = widgetsState[d.id];

      if (_.isFunction(newWidgetModel)) {
        // Find the Layer that the Widget should be created for.
        var layer;
        if (d.layer_id) {
          layer = vis.map.layers.get(d.layer_id);
        } else if (Number.isInteger(d.layerIndex)) {
          // TODO Since namedmap doesn't have ids we need to map in another way, here using index
          //   should we solve this in another way?
          layer = vis.map.layers.at(d.layerIndex);
        }

        newWidgetModel(attrs, layer, state, {autoStyleEnabled: opts.autoStyle});
      } else {
        cdb.log.error('No widget found for type ' + d.type);
      }
    });

    dashboardView.render();

    if (widgets.size() > 0) {
      vis.centerMapToOrigin();
    }

    vis.instantiateMap({
      success: function () {
        callback && callback(null, {
          dashboardView: dashboardView,
          widgets: widgetsService,
          vis: vis
        });
      },
      error: function () {
        var error = new Error('Map instantiation failed');
        console.log(error);
        callback && callback(error, {
          dashboardView: dashboardView,
          widgets: widgetsService,
          vis: vis
        });
      }
    });
  });
};

module.exports = function (selector, vizJSON, opts, callback) {
  var args = arguments;
  var fn = args[args.length - 1];

  if (_.isFunction(fn)) {
    callback = fn;
  }

  function _load (vizJSON) {
    createDashboard(selector, vizJSON, opts, function (error, dashboard) {
      var dash = new Dashboard(dashboard);
      dash.onStateChanged(_.debounce(function (state, url) {
        window.history.replaceState('Object', 'Title', url);
      }, 500), opts.share_urls);

      callback && callback(error, dash);
    });
  }

  if (typeof vizJSON === 'string') {
    cdb.core.Loader.get(vizJSON, function (data) {
      if (data) {
        _load(data, opts);
      } else {
        callback && callback(new Error('error fetching viz.json file'));
      }
    });
  } else {
    _load(vizJSON, opts);
  }
};
