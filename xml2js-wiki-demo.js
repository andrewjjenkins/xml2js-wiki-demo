var xml2js = require('xml2js')
  , http = require('http')
  , async = require('async')
  , util = require('util')
  , urlParser = require('url')
  , sprintf = require('sprintf').sprintf
  , fpm = require('lrs/forwardProxyModule');


var redirTarget = 'http://en.wikipedia.org/wiki/%(page)s?oldid=%(version)s';
var redirBody =
  '<html><head><title>Redirecting %(page)s</title></head>\n' +
  '<body>\n' +
  '  <h1>Redirecting to a human-edited version</h1>\n' +
  '  <p>The last version of %(page)s was edited by an anonymous user.</p>\n' +
  '  <p>Redirecting to the last human-edited version: \n' +
  '     <a href="%(target)s">%(target)s</a></p>\n'
  '</body></html>\n';

function debugInfo(req, resp, next, url, callback) {
  console.log('url:', url);
  callback();
}

function printHelp(req, resp, next, url, callback) {
  resp.end(sprintf(landingPageBody, {}));
  callback('Rendered help');
}

function skipIfNotArticle(req, resp, next, url, callback) {
  //FIXME: regex to internationalize
  if (req.headers.host != 'en.wikipedia.org') {
    callback([ '', req.headers.host + ' is not wikipedia']);
    return;
  }
  if (url.path.substring(0, 6) != '/wiki/') {
    callback([ '', url.path + ' is not a wiki article']);
    return;
  }
  console.log('Passing url ' + url.path);
  callback();
}

function eatErrorBody(resp, callback) {
  var errorBody = '';
  resp.on('data', function (chunk) { errorBody += chunk; });
  resp.on('end', function() { callback(null, errorBody) });
}

function redirectToVersion(resp, page, version) {
  var subs = { 'page': page, 'version': version };
  subs.target = sprintf(redirTarget, subs);
  var body = sprintf(redirBody, subs);
  console.log('Redirecting to: ', subs);
  resp.writeHead(302, 'Found',
                 { 'Location': subs.target,
                   'Content-Type': 'text/html',
                   'Content-Length': body.length });
  resp.end(body);
}

function revisionByRegisteredUser(revision) {
  var contributor = revision.contributor[0];
  if (contributor.username === undefined) {
    if (contributor.ip) {
      console.log('Revision was by an IP:', contributor.ip[0]);
      return false;
    } else {
      console.log('Revision was not by a user');
      return false;
    }
  } else {
    var username = contributor.username[0];
    if (/[0-9]+\.[0-9]+\.[0-9]+\.xxx/.exec(username)) {
      console.log('Revision was by an IP:', username);
      return false;
    } else {
      console.log('Revision was by a registered user:', username);
      return true;
    }
  }
}

function checkArticleRevisions(req, resp, next, url, callback) {
  var page = url.path.substring(6);
  if (/\/|:|\?|&/.exec(page)) {
    callback([ '', 'Page ' + url.path + ' had surprising characters']);
    return;
  }
  var revisionPath = '/w/index.php?title=Special:Export&pages=' + page
    + '&offset=0&limit=5&action=submit&dir=desc';

  async.waterfall([
    function makeRevisionRequest(callback) {
      var revisionReq = http.request({ host: req.connection.address().address,
                                       path: revisionPath,
                                       method: 'POST' /* req'd for good response */},
                                     function (revResp) { callback(null, revResp); });
      revisionReq.removeHeader('Host');
      revisionReq.addHeader('Host', 'en.wikipedia.org');
      revisionReq.addHeader('Content-Length', '0');
      revisionReq.addHeader('Accept', '*/*');
      revisionReq.end();
      revisionReq.on('error', function (err) {
        callback('Error making revision request: ' + util.inspect(err));
      });
    },
    function checkForErrorResponse(revResp, callback) {
      if (revResp.statusCode != 200) {
        eatErrorBody(revResp, function (err, body) {
          callback('Error response from revision request (' +
                   revResp.statusCode + '), headers: \n' + 
                   util.inspect(revResp.headers) + '\n, body:\n' + body);
        });
      }

      var respBody = '';
      revResp.on('data', function(chunk) { respBody += chunk; });
      revResp.on('end', function() {
        callback(null, respBody);
      });
      revResp.on('error', function (err) {
        callback('Error reading revision history: ' + err);
      });
    },
    function parseRevisionResponse(body, callback) {
      xml2js.parseString(body, function (err, obj) {
        console.log('Response: ' + util.inspect(obj, false, 3));
        var revs = obj.mediawiki.page[0].revision;
//        console.log('Revisions object: ' + util.inspect(revs, false, 3));
//        console.log('Revs length:', revs.length);
        for (var i = 0; i < revs.length; ++i) {
          if (revisionByRegisteredUser(revs[i])) {
            if (i === 0) {
              console.log('Yay no redirect');
              // Yay, no need to redirect.
              callback();
            } else {
              // First rev wasn't human, but we found one.  Redir.
              redirectToVersion(resp, page, revs[i].id[0]);
              callback();
            }
            return;
          }
        }
      });
    }
    ],
    function(err, result) {
      if (err) {
        callback([ 'ERR', err ]);
      } else {
        callback();
      }
    }
  );
}

fpm.on('exist', 'fp1', function (fp) {
  fp.on('request', function (req, resp, next) {
    var url = urlParser.parse(req.url);
    function curry(fn) {
      return function(callback) { fn(req, resp, next, url, callback); };
    }
    async.series([ 
//                   curry(debugInfo),
//                   curry(printHelp),
                   curry(skipIfNotArticle),
                   curry(checkArticleRevisions),
                 ],
                 function (err, results) {
      if (err && err[0].length > 0) {
        console.log('ERROR:', err[1]);
        resp.setHeader('Content-Type', 'text/plain');
        resp.end(err[1]);
      }
      next();
    });
  });
  console.log('Listening for requests on fp1');
});
