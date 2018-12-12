# serverless-star
-------------

_Serverless Star_ is a serverless plugin that allows an engineer to easily define, generate, and process distributed workloads of any size. This could be used for test load generation, ETL jobs, mapreduce jobs, plan/execute patterns, scatter/gather tasks, or any other distributed task that needs at-least-once guarantees but not order guarantees.

A _serverless star_ job can have between 1 and _n_ steps. Mapreduce has two steps (map and reduce), an ETL job has three steps (extract, transform and load), and other types of jobs may have more or fewer. Steps are defined in the `serverless.yml` file and the handler functions for each step are defined in your `.js` file(s) and referenced in the `serverless.yml`.

## Examples

These are some simple examples that can be used as templates for your `serverless-star` project. These examples contain code that, while not unit tested or production-ready, should be fully functional and should be able to serve as a template for your projects.

### Replay

For this example, we are creating a job that will read events from S3 files and send them to Kinesis. For this job we will have two steps: _plan_ and _execute_. You could call these steps _map_ and _reduce_ or you could call them _jane_ and _bob_ if you wanted; whatever names are meaningful to you. Our two steps will do the following:

1. **Plan**: scan the S3 bucket and generate an execute step for each S3 file key.
2. **Execute**: read the file and write each object to Kinesis.

**serverless.yml**

```yml
star:
  plan: # step name/lambda name
    handler: replay.scanS3
  execute:
    handler: replay.sendToKinesis
```

**replay.js**

```javascript
const AWS = require('aws-sdk')
const s3 = new AWS.S3()
const kinesis = new AWS.Kinesis()

const baseParams = {
  Bucket: 'immutable-ledger'
}

module.exports.scanS3 = (data, generate) => {
  const listNext = params =>
    s3.listObjectsV2(params).promise()
      .then(({ Contents, IsTruncated, NextContinuationToken }) => {
        // invoke the `execute` step for each key we got from S3:
        Contents.map(({ Key }) => generate({ step: 'execute', data: Key }))
        if (IsTruncated) {
          return listNext(Object.assign(
            {},
            baseParams,
            { ContinuationToken: NextContinuationToken }
          ))
        }
      })
  return listNext(baseParams)
}

module.exports.sendToKinesis = (s3Key) => {
  const params = Object.assign({}, baseParams, { Key: s3Key })
  const sendNextToKinesis = (events, offset = 0) => {
    const end = offset + 500
    const eventsToSend = events.slice(offset, end)
    const hasMoreEvents = (end < events.length)
    const Params = {
      Records: eventsToSend,
      StreamName: 'event-source',
    }
    return kinesis.putRecords(params).promise()
      .then(() => {
        if (hasMoreEvents) {
          return sendNextToKinesis(events, end)
        }
      })
  }
  return s3.readObject(params).promise()
    .then(({ Body }) => {
      const events = JSON.parse(Body.toString())
      return sendNextToKinesis(events)
    })
}
```

### Generate Load

This project implements a load-generator. Note that this example is extremely simplistic: it generates load at a fixed rate for a period of time less than the timeout of a single generator lambda. A full-featured load generator could be easily built using `serverless-star`, but would be too big for an example.

**serverless.yml**

```yml
star:
  plan: # step name/lambda name
    handler: replay.generateLoad
    timeout: 600
  execute:
    handler: replay.executeTests
```

**replay.js**

```javascript
const https = require('https')

module.exports.generateLoad = ({ rps, duration, url }, generate) => {
  const executors = Array(rps).fill()
  return new Promise(resolve => {
    const executeNext = () => {
      const now = Date.now()
      if (endTime < Date.now()) {
        return resolve()
      }
      // invoke the `execute` step [rps] times:
      executors.map(() => generate({ step: 'execute', data: url }))
      setTimeout(executeNext, 1000)
    }
    executeNext()
  })
}

module.exports.executeTests = (url) => new Promise(resolve => {
    https.get(url, response => {
      resolve(response.statusCode)
    }).on('error', reject)
  })
```

Note that the above generator has a 5-minute limit because of the `timeout: 600` field in the `serverless.yml` file. Rolling over for a longer run, however, would be trivial. In the `generateLoad` handler, this code would kick off a new generator with a fresh 5-minute timeout:

```javascript
generate({ step: 'plan', data: { rps, duration, url } })
```

## How It Works

Serverless star uses SQS behind the scene to stage and distribute workload. To "generate" a step invocation is to enqueue a serialized value to be deserialized and passed to a handler at a later time. Given the following `serverless.yml` file:

```yml
star:
  plan:
    handler: my-job.plan
  execute:
    handler: my-job.execute
```

the following resources will be created:

**Lambda: plan**
The lambda handling items in the _plan_ queue and calling `require('./my-job.js').plan(message)` for each dequeued message.

**Lambda: execute**
The lambda handling items in the _execute_ queue and calling `require('./my-job.js').execute(message)` for each dequeued message.

**Lambda: generate**
A helper function that manually enqueues a step. This function is not used internally. For example, calling this function with an argument `{ step: 'plan', data: 'foo' }` will cause the _plan_ handler to be called like this: `require('./my-job.js').plan('foo')`. This function provides an easy way to "kick off" a job either manually or in response to an API Gateway request, for example.

**SQS: plan**
The queue for _plan_ invocations.

**SQS: execute**
The queue for _execute_ invocations.

## Declarative API

_work in progress..._
