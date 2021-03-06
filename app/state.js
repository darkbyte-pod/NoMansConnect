import {remote} from 'electron';
import os from 'os';
import fs from 'graceful-fs';
import Reflux from 'reflux';
Reflux.setEventEmitter(require('events').EventEmitter);
import _ from 'lodash';
import each from './each';
import * as utils from './utils';
import knownGalaxies from './static/galaxies.json';
import knownProducts from './static/knownProducts.json';
import Raven from 'raven-js';

const {dialog} = remote;

var state = Reflux.createStore({
  init(){
    this.completedMigration = false;
    this.knownProducts = knownProducts;
    this.galaxies = knownGalaxies;
    this.state = {
      // Core
      version: '0.14.0',
      apiBase: 'https://neuropuff.com/api/',
      winVersion: os.release(),
      machineId: null,
      protected: false,
      init: true,
      homedir: remote.app.getPath('home'),
      configDir: remote.app.getPath('userData'),
      width: window.innerWidth,
      height: window.innerHeight,
      tableData: [],
      title: 'NO MAN\'S CONNECT',
      installDirectory: null,
      saveDirectory: null,
      saveFileName: '',
      mode: 'normal',
      storedBases: [],
      storedLocations: [],
      remoteLocations: [],
      remoteLength: 0,
      currentLocation: null,
      selectedLocation: null,
      username: 'Explorer',
      profile: null,
      favorites: [],
      mods: [],
      selectedImage: null,
      autoCapture: false,
      selectedGalaxy: 0,
      galaxyOptions: [],
      pollRate: 60000,
      ps4User: process.platform === 'darwin',
      // UI
      settingsOpen: false,
      editorOpen: false,
      baseOpen: false,
      view: 'index',
      sort: '-created',
      search: '',
      searchInProgress: false,
      searchCache: {
        results: [],
        count: 0,
        next: null,
        prev: null
      },
      page: 1,
      pageSize: 60,
      paginationEnabled: true,
      loading: false,
      maximized: false,
      mapLines: false,
      map3d: false,
      mapDrawDistance: false,
      wallpaper: null,
      filterOthers: false,
      useGAFormat: false,
      usernameOverride: false,
      registerLocation: false,
      remoteLocationsColumns: 1,
      sortStoredByTime: false,
      showOnlyNames: false,
      showOnlyDesc: false,
      showOnlyScreenshots: false,
      showOnlyGalaxy: false,
      showOnlyBases: false,
      showOnlyPC: false,
      sortByDistance: false,
      sortByModded: false,
      show: {
        Shared: true,
        PS4: true,
        Explored: true,
        Center: true,
        Favorite: true,
        Current: true,
        Selected: true,
        Base: true
      },
      compactRemote: false,
      maintenanceTS: Date.now(),
      offline: false,
      error: ''
    };

    if (process.env.NODE_ENV === 'production') {
      Raven
        .config('https://9729d511f78f40d0ae5ebdeabc9217fc@sentry.io/180778', {
          environment: process.env.NODE_ENV,
          release: this.state.version,
          dataCallback: (data)=>{
            _.assignIn(data.user, {
              username: this.state.username,
              resourceUsage: remote.app.getAppMetrics(),
              winVersion: this.state.winVersion,
              remoteLength: this.state.remoteLength,
              map3d: this.state.map3d,
              mapDrawDistance: this.state.mapDrawDistance,
              pollRate: this.state.pollRate
            });
            return data;
          }
        })
        .install();
    }

    let saveDirPath;
    let basePath = this.state.configDir.split('\\AppData')[0];
    let steamPath = `${basePath}\\AppData\\Roaming\\HelloGames\\NMS`;
    let gogPath = `${basePath}\\AppData\\Roaming\\HelloGames\\NMS\\DefaultUser`;
    if (fs.existsSync(steamPath)) {
      saveDirPath = steamPath;
    } else if (fs.existsSync(gogPath)) {
      saveDirPath = gogPath;
    }

    console.log(saveDirPath);

    this.state.saveDirectory = saveDirPath;

    this.handleJsonWorker();
    window.jsonWorker.postMessage({
      method: 'new',
      default: {
        remoteLocations: []
      },
      fileName: 'cache.json',
      configDir: this.state.configDir,
    });
    this.handleSettingsWorker();
    this.settingsKeys = [
      'maintenanceTS',
      'wallpaper',
      'installDirectory',
      'saveDirectory',
      'username',
      'mapLines',
      'map3d',
      'mapDrawDistance',
      'show',
      'filterOthers',
      'useGAFormat',
      'remoteLocationsColumns',
      'sortStoredByTime',
      'pollRate',
      'mode',
      'storedBases',
      'storedLocations',
      'favorites',
      'autoCapture',
      'ps4User',
      'compactRemote',
      'offline',
      'showOnlyNames',
      'showOnlyDesc',
      'showOnlyScreenshots',
      'showOnlyGalaxy',
      'showOnlyBases',
      'showOnlyPC',
      'sortByDistance',
      'sortByModded'
    ];
    this.handleSettingsMigration();
    const settings = _.pick(this.state, this.settingsKeys);
    window.settingsWorker.postMessage({
      method: 'new',
      default: settings,
      fileName: 'settings.json',
      configDir: this.state.configDir,
    });

  },
  handleJsonWorker(){
    window.jsonWorker.onmessage = (e)=>{
      this.state.remoteLocations = JSON.parse(e.data).remoteLocations;

      if (!this.state.remoteLocations || this.state.remoteLocations && this.state.remoteLocations.results === undefined) {
        this.state.remoteLocations = {
          results: [],
          count: 0,
          next: null,
          prev: null
        };
      } else {
        this.state.page = Math.floor(this.state.remoteLocations.results.length / this.state.pageSize) + 1;
      }
      this.trigger(this.state);
    }
  },
  handleSettingsWorker(){
    window.settingsWorker.onmessage = (e)=>{
      let data = JSON.parse(e.data);
      let stateUpdate = {};
      if (!data.maintenanceTS) {
        stateUpdate.maintenanceTS = this.state.maintenanceTS - 6.048e+8;
      }
      if (data.offline) {
        stateUpdate.title = 'NO MAN\'S DISCONNECT';
        stateUpdate.init = false;
      }
      each(data, (value, key)=>{
        if (this.settingsKeys.indexOf(key) > -1) {
          stateUpdate[key] = value;
        }
      });
      if (this.completedMigration) {
        utils.store.clear();
      }

      this.set(stateUpdate);
    }
  },
  handleMaintenance(obj){
    return new Promise((resolve, reject)=>{
      if (this.state.maintenanceTS + 6.048e+8 < Date.now()) {
        // Maintenance task set to run once a week
        let locations = [];
        _.each(obj.remoteLocations.results, (location, i)=>{
          // Remove locations with invalid coordinates
          if (location.data.VoxelY > -128 && location.data.VoxelY < 127
            && location.data.VoxelZ > -2048 && location.data.VoxelZ < 2047
            && location.data.VoxelX > -2048 && location.data.VoxelX < 2047) {
            locations.push(location)
          }
        });
        locations = _.uniqBy(locations, (location)=>{
          return location.data.id;
        });
        obj.remoteLocations.results = locations;
        obj.remoteLocations.count = locations.length;

        _.defer(()=>{
          obj.maintenanceTS = Date.now();
          resolve(obj)
        });
      } else {
        resolve(obj);
      }
    });
  },
  set(obj, cb=null){
    if (process.env.NODE_ENV === 'development') {
      try {
        throw new Error('STATE STACK')
      } catch (e) {
        let stackParts = e.stack.split('\n');
        console.log('STATE CALLEE: ', stackParts[2].trim());
      }
    }
    obj = _.clone(obj);
    console.log('STATE INPUT: ', obj);
    if (obj.selectedLocation) {
      this.state.selectedLocation = null;
    }

    let objRemoteLen = 0;
    if (obj.remoteLocations) {
      objRemoteLen = obj.remoteLocations.results.length;
    }
    if (objRemoteLen === 0 && !this.state.offline && this.state.remoteLocations && this.state.remoteLocations.results) {
      objRemoteLen = this.state.remoteLocations.results.length;
    }

    if (obj.remoteLocations
      && objRemoteLen > 0
      && this.state.search.length === 0
      && this.state.remoteLocations
      && this.state.remoteLocations.results
      && this.state.remoteLocations.results.length > 0) {
      this.handleMaintenance(obj).then((newObj)=>{
        window.jsonWorker.postMessage({
          method: 'set',
          key: 'remoteLocations',
          value: JSON.stringify(newObj.remoteLocations),
        });
        this.handleState(newObj, cb, objRemoteLen);
      });
    } else {
      this.handleState(obj, cb, objRemoteLen);
    }
  },
  handleState(obj, cb=null, objRemoteLen){
    if (obj.remoteLocations && obj.remoteLocations.results) {
      this.state.remoteLength = objRemoteLen;
    }

    if (obj.error) {
      this.displayErrorDialog(obj.error);
      obj.error = '';
    }

    _.assignIn(this.state, obj);
    console.log('STATE: ', this.state);
    this.trigger(this.state);

    each(obj, (value, key)=>{
      _.delay(()=>{
        if (this.settingsKeys.indexOf(key) > -1) {
          window.settingsWorker.postMessage({
            method: 'set',
            key: key,
            value: JSON.stringify(value),
          });
        }
      }, 100);
    });

    if (cb) {
      _.defer(cb);
    }
  },
  get(){
    return this.state;
  },
  handleSettingsMigration(){
    let username = utils.store.get('username');
    if (username) {
      this.state.username = username;
      let maintenanceTS = utils.store.get('maintenanceTS');
      if (maintenanceTS) {
        this.state.storedBases = maintenanceTS;
      }
      let wallpaper = utils.store.get('wallpaper');
      if (wallpaper) {
        this.state.wallpaper = wallpaper;
      }
      let installDirectory = utils.store.get('installDirectory');
      if (installDirectory) {
        this.state.installDirectory = installDirectory;
      }
      let saveDirectory = utils.store.get('saveDirectory');
      if (saveDirectory) {
        this.state.saveDirectory = saveDirectory;
      }
      let mapLines = utils.store.get('mapLines');
      if (mapLines) {
        this.state.mapLines = mapLines;
      }
      let map3d = utils.store.get('map3d');
      if (map3d) {
        this.state.map3d = map3d;
      }
      let mapDrawDistance = utils.store.get('mapDrawDistance');
      if (mapDrawDistance) {
        this.state.mapDrawDistance = mapDrawDistance;
      }
      let show = utils.store.get('show');
      if (show) {
        this.state.show = show;
      }
      let filterOthers = utils.store.get('filterOthers');
      if (filterOthers) {
        this.state.filterOthers = filterOthers;
      }
      let useGAFormat = utils.store.get('useGAFormat');
      if (useGAFormat) {
        this.state.useGAFormat = useGAFormat;
      }
      let remoteLocationsColumns = utils.store.get('remoteLocationsColumns');
      if (remoteLocationsColumns) {
        this.state.remoteLocationsColumns = remoteLocationsColumns;
      }
      let sortStoredByTime = utils.store.get('sortStoredByTime');
      if (sortStoredByTime) {
        this.state.sortStoredByTime = sortStoredByTime;
      }
      let pollRate = utils.store.get('pollRate');
      if (pollRate) {
        this.state.pollRate = pollRate;
      }
      let mode = utils.store.get('mode');
      if (mode) {
        this.state.mode = mode;
      }
      let storedBases = utils.store.get('storedBases');
      if (storedBases) {
        this.state.storedBases = storedBases;
      }
      let storedLocations = utils.store.get('storedLocations');
      if (storedLocations) {
        this.state.storedLocations = storedLocations[this.state.mode];
      }
      let favorites = utils.store.get('favorites');
      if (favorites) {
        this.state.favorites = favorites;
      }
      let autoCapture = utils.store.get('autoCapture');
      if (autoCapture !== null) {
        this.state.autoCapture = autoCapture;
      }
      this.completedMigration = true;
    }
  },
  displayErrorDialog(error){
    dialog.showErrorBox('NMC Error', error);
  },
});
window.state = state;
export default state;