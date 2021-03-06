'use strict';
var aws = require("aws-sdk");
var request = require("request");
const stepfunctions = new aws.StepFunctions();
const log_group = process.env.AWS_LAMBDA_LOG_GROUP_NAME;
const stream_group = process.env.AWS_LAMBDA_LOG_STREAM_NAME;
const logUrl = `https://${process.env.AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${process.env.AWS_REGION}#logEventViewer:group=${log_group};stream=${stream_group}`; // final url for cloud watch
const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
const jobName = process.env.jobName;

var shopifyOptions = {
    method: 'GET',
    url: '',
    qs: {
        page: 1,
        limit: 250
    }
};

function log(phase, statusMessage, status, jobItemNumber, jobItemType, createdAt = null) {
    console.log(`Logging ${statusMessage} to database`);
    return invokeLambda("DatabaseInsertLogs", { jobName, logUrl, status, extraFields: { phase, functionName }, jobItemNumber, statusMessage, createdAt, updatedAt: new Date().getTime(), integrationId: 1, jobItemType }, 'us-west-2'); // integrationID = 1 for Go Integration ZohoINV to Shopify integration
}

function invokeLambda(functionName, jsonPayload, region = process.env.AWS_REGION) {
    return new Promise((resolve, reject) => {
        console.log(`Invoking ${functionName}`);
        var lambda = new aws.Lambda({ region });
        lambda.invoke({
            FunctionName: functionName,
            Payload: JSON.stringify(jsonPayload, null, 2) // pass params
        }, function (error, data) {
            console.log("Invoke Lambda response : ", data);
            if (error) {
                console.log(error);
                reject(error);
            }
            if (data.Payload) {
                var response = JSON.parse(data.Payload);
                console.log(response);
                resolve(response);
            }
        });
    });
}

function zohoInvRequest(requestOptions, zohoConfig) {
    var options =
        {
            method: requestOptions.method,
            url: 'https://inventory.zoho.com/api/v1' + requestOptions.url,
            qs: zohoConfig,
            headers:
            {
                'cache-control': 'no-cache',
                'content-type': requestOptions.contentType || 'application/x-www-form-urlencoded'
            }
        };
    if (requestOptions.body) {
        options.form = requestOptions.body
    }
    console.log("Options:", options);
    return new Promise((resolve, reject) => {
        request(options, (error, response, body) => {
            if (error) {
                console.log("Request error", error || body);
                reject(error || body);
            } else {
                body = JSON.parse(body);
                console.log("Response", body);
                if (body.code != 0) reject(body);
                else resolve(body);
            }
        });
    })
}

function shopifyRequest(requestOptions, shopifyConfig) {
    return new Promise((resolve, reject) => {
        var options = {
            method: requestOptions.method,
            url: `https://${shopifyConfig.apiKey}:${shopifyConfig.password}@${shopifyConfig.shopName}.myshopify.com/${requestOptions.url}`,
            headers:
            {
                'content-type': 'application/json'
            },
            body: requestOptions.body,
            json: true
        };
        request(options, function (error, response, body) {
            if (error) {
                console.log(error);
                reject(error);
            } else {
                console.log("Shopify response", body);
                resolve(body);
            }
        });
    });
}

const invokeStepFunction = (input,context,sfName,name)=>{
    let accountId = context.invokedFunctionArn.split(':')[4];
    let state = context.invokedFunctionArn.split(':')[3];
    let params = {
        stateMachineArn: `arn:aws:states:${state}:${accountId}:stateMachine:${sfName}`,
        input: JSON.stringify(input),
        name: `${name}-${new Date().getTime()}`
    };
    return new Promise((resolve,reject)=>{
        stepfunctions.startExecution(params, (error,data)=>{
            if(error)
            {
                console.log(`Fail to execute ${sfName} step function! Error: ${error}`);
                reject(`Fail to execute ${sfName} step function! Error: ${error}`);
            }
            else
            {
                console.log(data);
                resolve(data);
            }
        });
    });
}

function zohoCrmGetRequest(requestOptions, authtoken) {
    var options = {
        method: requestOptions.method,
        url: `https://crm.zoho.com/crm/private/${requestOptions/datatype}${requestOptions/url}`,
        params: Object.assign( {}, {
          authtoken: authtoken,
          newFormat: 2,
          scope: 'crmapi',
          
        }, {
            criteria: requestOptions.criteria,
            duplicateCheck: requestOptions.duplicateCheck
        })
      };
    return axios(options);
}

function timedInvoke(functionName, payload, region, interval) {
    return new Promise((resolve, reject) => {
        setTimeout(function () {
            invokeLambda(functionName, payload, region).then(resolve).catch(reject);
        }, interval);
    })
}

function shopifyRecursiveRequest(requestOptions, shopifyConfig, key) {
    return new Promise((resolve, reject) => {
        var mergedResponse = [];
        var req = (requestOptions, shopifyConfig, cb) => {
            try {
                var options = {
                    method: requestOptions.method,
                    url: `https://${shopifyConfig.apiKey}:${shopifyConfig.password}@${shopifyConfig.shopName}.myshopify.com/${requestOptions.url}`,
                    headers:
                    {
                        'content-type': 'application/json'
                    },
                    body: requestOptions.body,
                    json: true
                };
                request(options, function (error, response, body) {
                    if (error || body.errors) {
                        console.log(error || JSON.stringify(body.errors));
                        reject(error || JSON.stringify(body.errors));
                    } else {
                        if (body[key].length > 0) {
                            mergedResponse = mergedResponse.concat(body[key]);
                            requestOptions.body.page += 1;
                            req(requestOptions, shopifyConfig, cb);
                        } else {
                            cb(null, mergedResponse);
                        }
                    }
                });
            } catch (error) {
                cb(error);
            }
        }
        req(requestOptions, shopifyConfig, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        })
    });
}

function zohInvRecursiveRequest(page, cb) {
    options.qs.page = page;
    var data = [];
    request(options, function (error, response, body) {
        if (error) {
            console.log(error);
            cb(null);
        }
        var body = JSON.parse(body);
        if (body.code != 0) {
            console.log(body);
            cb(null);
            return;
        }
        console.log("Item count", body.items.length, data.length)
        if (body.items.length > 0) {
            data = data.concat(body.items);
        } else {
            cb(data);
        }
    });
}

module.exports = { functionName, jobName, logUrl, log, invokeLambda, shopifyRequest, zohoInvRequest, timedInvoke, shopifyRecursiveRequest, zohInvRecursiveRequest,invokeStepFunction};

