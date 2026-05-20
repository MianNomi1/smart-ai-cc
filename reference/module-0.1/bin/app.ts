#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { getConfig } from "../lib/config";
import { DataStack } from "../lib/stacks/data-stack";
import { LambdaStack } from "../lib/stacks/lambda-stack";

const app = new cdk.App();

const envName = app.node.tryGetContext("env") || process.env.DEPLOY_ENV || "dev";
const config = getConfig(envName);

const dataStack = new DataStack(app, { config });

new LambdaStack(app, {
  config,
  policiesTable: dataStack.policiesTable,
  claimsTable: dataStack.claimsTable,
  documentsBucket: dataStack.documentsBucket,
});

app.synth();
