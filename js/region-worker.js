// Builds an area (terrain, vegetation, trees, surroundings) off the main thread, so the map stays smooth.
const V=(self.location.search.match(/v=(\d+)/)||[])[1]||"0";
importScripts("config.js?v="+V,"geo.js?v="+V,"borders.js?v="+V,"sources.js?v="+V,"region.js?v="+V);
