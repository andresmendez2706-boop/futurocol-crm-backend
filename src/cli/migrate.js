'use strict';

const { migrate } = require('../migrate');
const { pool } = require('../db');

migrate().then(() => pool.end()).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
