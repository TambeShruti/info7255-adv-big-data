import express from "express";
import { createClient } from "redis";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import crypto from "crypto";
import { google } from "googleapis";

const app = express();
app.use(express.json());
app.set("etag", false);
const PORT = 3001;

// Initialize Redis client
const redisClient = createClient();
redisClient.on("error", (err) => console.log("Redis Client Error", err));
await redisClient.connect();

// Initialize AJV for JSON schema validation
const ajv = new Ajv();
addFormats(ajv);

// JSON Schema for plan data
const planSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    planCostShares: {
      type: "object",
      properties: {
        deductible: { type: "integer" },
        _org: { type: "string" },
        copay: { type: "integer" },
        objectId: { type: "string" },
        objectType: { type: "string" },
      },
      required: ["deductible", "_org", "copay", "objectId", "objectType"],
    },
    linkedPlanServices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          linkedService: {
            type: "object",
            properties: {
              _org: { type: "string" },
              objectId: { type: "string" },
              objectType: { type: "string" },
              name: { type: "string" },
            },
            required: ["_org", "objectId", "objectType", "name"],
          },
          planserviceCostShares: {
            type: "object",
            properties: {
              deductible: { type: "integer" },
              _org: { type: "string" },
              copay: { type: "integer" },
              objectId: { type: "string" },
              objectType: { type: "string" },
            },
            required: ["deductible", "_org", "copay", "objectId", "objectType"],
          },
          _org: { type: "string" },
          objectId: { type: "string" },
          objectType: { type: "string" },
        },
        required: [
          "linkedService",
          "planserviceCostShares",
          "_org",
          "objectId",
          "objectType",
        ],
      },
    },
    _org: { type: "string" },
    objectId: { type: "string" },
    objectType: { type: "string" },
    planType: { type: "string" },
    creationDate: { type: "string" },
  },
  required: [
    "planCostShares",
    "linkedPlanServices",
    "_org",
    "objectId",
    "objectType",
    "planType",
    "creationDate",
  ],
};

// Compile the schema with AJV
const validatePlanData = ajv.compile(planSchema);

function generateETag(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// Google Identity Provider configuration
const googleClientId =
  "406295759537-3k73pfau647e1ruevehhbt558uiq83bg.apps.googleusercontent.com";
const oauth2Client = new google.auth.OAuth2(googleClientId);

// Middleware to validate bearer token

const auth = async (req, res, next) => {
  try {
    if (!req.headers.authorization) {
      return res.status(401).send("Unauthorized - No authorization header");
    }
    const token = req.headers.authorization.split(" ")[1];
    const ticket = await oauth2Client.verifyIdToken({
      idToken: token,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();
    req.user = payload;
    next();
  } catch (err) {
    console.error(`Authentication error: ${err}`);
    return res.status(401).send("Unauthorized - Invalid token");
  }
};

const validateSchema = (schema) => {
  return (req, res, next) => {
    const validate = ajv.compile(schema);
    const valid = validate(req.body);
    if (!valid) {
      return res
        .status(400)
        .json({ message: "Validation error", errors: validate.errors });
    }
    next();
  };
};
//CRUD OPERATIONS

// POST /plans - Add a new plan
app.post("/v1/plans", auth, validateSchema(planSchema), async (req, res) => {
  if (!validatePlanData(req.body)) {
    return res.status(400).json({
      message: "Validation error",
      errors: validatePlanData.errors,
    });
  }

  const planId = req.body.objectId; // Using planId as a unique identifier for plans
  const data = JSON.stringify(req.body);
  const existingPlan = await redisClient.get(`plans:${planId}`);

  // Check if the plan already exists
  if (existingPlan) {
    const existingETag = generateETag(existingPlan);
    const clientETag = req.header("If-None-Match");

    // Check if the client's ETag matches the existing ETag
    if (clientETag && clientETag === existingETag) {
      return res.status(304).send(); // Not Modified
    }

    return res.status(409).json({ message: "Conflict - Plan already exists" });
  }

  await redisClient.set(`plans:${planId}`, data);
  const etag = generateETag(data); //ETag generation logic
  res.set("ETag", etag);
  res.status(201).json({ message: "Plan added", planId });
});

// GET /plans/:planId - Retrieve a plan details
app.get("/v1/plans/:planId", auth, async (req, res) => {
  const planId = req.params.planId;
  const plan = await redisClient.get(`plans:${planId}`);

  if (!plan) {
    return res.status(404).json({ message: "Plan not found" });
  }

  const etag = generateETag(plan);
  const clientETag = req.header("If-None-Match");

  if (clientETag && clientETag === etag) {
    return res.status(304).send(); // Not Modified
  }

  res.header("ETag", etag);
  res.status(200).json(JSON.parse(plan));
});

// GET /plans/ - Retrieve all plan details
app.get("/v1/plans/", auth, async (req, res) => {
  const planIdKeys = await redisClient.keys("planSchema:*");
  const plans = [];
  if (!planIdKeys.length) {
    // Check if the array is empty
    return res.status(404).json({ message: "Plans not found" });
  }

  for (const key of planIdKeys) {
    const plan = await redisClient.get(key);
    plans.push(JSON.parse(plan));
  }

  res.status(200).json(plans);
});

// PUT /v1/plans/:planId - Update a plan
app.put("/v1/plans/:planId", auth, async (req, res) => {
  const planId = req.params.planId;
  const data = JSON.stringify(req.body);

  // Check if the plan exists
  const existingPlan = await redisClient.get(`plans:${planId}`);
  if (!existingPlan) {
    return res.status(404).json({ message: "Plan not found" });
  }

  // Generate ETag for the existing plan
  const existingETag = generateETag(existingPlan);
  const clientETag = req.header("If-Match");

  // Check if the client's ETag matches the existing ETag
  if (!clientETag || clientETag !== existingETag) {
    return res.status(412).json({ message: "Precondition Failed" });
  }

  // Update the plan
  await redisClient.set(`plans:${planId}`, data);
  const newETag = generateETag(data);

  res.set("ETag", newETag);
  res.status(200).json({ message: "Plan updated", planId });
});

// DELETE /v1/plans/:planId - Delete a plan
app.delete("/v1/plans/:planId", auth, async (req, res) => {
  const planId = req.params.planId;
  const result = await redisClient.del(`plans:${planId}`);

  if (result === 1) {
    res.status(204).send();
  } else {
    res.status(404).json({ message: "Plan not found" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
