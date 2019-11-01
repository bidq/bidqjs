# bidqjs

JS SDK for BidQ

## Usage (creating tasks)

```js
const BidQ = require("@bidq/client");

const bidq = new BidQ({ port: 8888 });

async function main() {
  const jobId = await qbid.submit("add", { x: 1, y: 2 }, 2000);
  try {
    console.log(await qbid.get(jobId));
  } catch (err) {
    console.error(err);
  } finally {
    await qbid.close();
  }
}

main();
```

## Usage (resolving tasks)

```js
const BidQ = require("@bidq/client");

const bidq = new BidQ({ port: 8888 });

qbid.on("add", ({ x, y }, resolve) => {
  console.log("Adding...");
  resolve(x + y);
});
```
