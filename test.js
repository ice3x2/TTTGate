const geoip = require('geoip-lite');


const ip = "223.38.36.18";
const geo = geoip.lookup(ip);

console.log(geo);