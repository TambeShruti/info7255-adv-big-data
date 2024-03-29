const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const app = express();

// Enable cors
app.use(cors());

// convert the response into application JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Convert the incoming API response to JSON
app.use(express.json());

// register all the routes of the application
app.use("/v1", routes);

module.exports = app;
