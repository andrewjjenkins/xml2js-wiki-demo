xml2js-wiki-demo
================

Demo using the LineRate Proxy Scripting Engine and xml2js to filter Wikipedia

# Purpose

Wikipedia articles are publicly edited. Some edits are associated with
particular usernames. However, anyone on the Internet can click "edit" and make
a change; those edits are "by IP".  Often, "by IP" edits are advertising
robots, vandals, or people/organizations with a point-of-view to inject.

When a user goes through a proxy running this script, they see the latest
revision of an article that was edited by a user with a username.  This may be
a better revision, because that edit was less likely to be from a robot or
vandal or POV-pusher.

In reality, this demo is intended to exhibit the LineRate Proxy Scripting
Engine.

# How it works

A forward-proxy object is configured through the normal means (CLI, REST JSON
API, or web GUI). A range virtual-ip is created that listens for connections
that are intended for the wikipedia servers. The script is attached to that
forward proxy. The LineRate Proxy system is then placed into the network so
that user requests are proxied through it.

When a user browses to a webpage, such as:

  [`http://en.wikipedia.org/w/index.php?title=Chunked_transfer_encoding`](http://en.wikipedia.org/w/index.php?title=Chunked_transfer_encoding)

the browser does DNS resolution as normal.  Then, it submits an HTTP request to
the resolved address.  Since the range virtual-ip is listening at that address,
the forward-proxy receives the request.  The script is invoked, and gets to
choose how to handle it.

One option for the script is to simply call `next()` which means "I have
nothing else to do for this request"; in this case, the request continues along
the datapath, goes out to Wikipedia, gets the normal response, and this goes
back to the client.  Once `next()` is called, the script is no longer involved
in processing the response, and the proxying happens through the low-level,
high-performance proxy system. This is the path used for all the resources that
aren't the wikipedia article.  So, `favicon.ico` and the helper Javascripts and
wikipedia logo bypass the rest of the processing.

However, for the main article request, the scripting engine holds the request,
and makes a new HTTP request to get the history of the article, for instance:

    POST /w/index.php?title=Special:Export&pages=Chunked_transfer_encoding&&offset=0&limit=5&action=submit&dir=desc 1.1
    Host: en.wikipedia.org
    Accept: */*
    Content-Length: 0
    
The POST is a Wikipedia requirement to get full version information, even
though the body of the POST is empty.  The HTTP response has a body in XML.
The xml2js node module parses it into a javascript object, and the script can
walk into the object and find the revisions and authors.

If the first author is by a registered user, then the `next()` call for the
original user request is invoked and the request is passed through to the
Wikipedia servers, and the response returned to the user.

If the first author is not a registered user, then the script walks backward in
the revision history until it finds a revision that was made by a registered
user.  Then, it writes a response back to the user that is a temporary redirect
to that version of the page, like:

    HTTP/1.1 302 Found
    Location: http://en.wikipedia.org/w/index.php?title=Chunked_transfer_encoding?oldid=563242545
    Content-Length: xxx
    <html><head><title>Redirecting Chunked_transfer_encoding</title></head>
    <body>
      <h1>Redirecting to a human-edited version</h1>
      <p>The last version of Chunked_transfer_encoding was edited by an anonymous user.</p>
      <p>Redirecting to the last human-edited version: 
         <a href="...">...</a></p>
    </body></html>

# Configuring the Proxy

This config snippet is the relevant portion of config on the LineRate Proxy system:

    !
    interface em0
     ipv6 address fe80::5054:ff:fe00:6/64 link-local
     ip address 10.126.32.6 255.255.0.0
    !
    forward-proxy fp1
     attach virtual-ip vip-wiki
     admin-status online
    !
    virtual-ip vip-wiki
     ! FIXME: ip range may have to change for your location
     ip range 208.80.0.0 208.81.0.0 80
     service http
     admin-status online
    !
    script xml2js-demo
     source file "xml2js-wiki-demo.js"
     admin-status online

# Modules used

* [xml2js](https://github.com/Leonidas-from-XIV/node-xml2js) for parsing the XML version history from Wikipedia
* [http](http://nodejs.org/dist/v0.8.3/docs/api/http.html) for making new HTTP requests to get version history
* [async](https://github.com/caolan/async) for chaining the functions that make up the script (waterfall and series)
* [util](http://nodejs.org/dist/v0.8.3/docs/api/util.html) for inspecting objects and printing debug info
* [url](http://nodejs.org/dist/v0.8.3/docs/api/url.html) for parsing the user's request URL so we only hit on wikipedia article requests
* [sprintf](http://www.diveintojavascript.com/projects/javascript-sprintf) for templating
* LineRate Proxy's custom high performance Forward Proxy module for intercepting the request and redirecting the response
