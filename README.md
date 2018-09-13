## Businesslogic.online connector

A small library that allows you toconnect to https://businesslogic.online and do calculations.

## Installation
  `npm install businesslogic`

## Usage
You are able to use businesslogic in different ways

### Programmatically
Here is an example how youcan use it directly on the page using code

```
  <script type="module" src="Businesslogic.js"></script>
  <script>
      window.onload = function () {
          // We can execute a webservice using Webservice class
          var biz = new Businesslogic.Webservice({key: '727553b1062845b4865dcbcee130051c'});
          biz.getResult();
      };
  </script>
```


## Contributing
In lieu of a formal style guide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code.

- Clone or fork this repository
- Make sure you have [node.js](https://nodejs.org/) installed
- run `npm install -g webpack webpack-dev-server typescript` to install global dependencies
- run `npm install` to install dependencies
- run `npm start` to fire up dev server
- open browser to [`http://localhost:3000`](http://localhost:3000)