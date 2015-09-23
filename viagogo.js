var highland = require('highland')
var request = require('request')
var retryMe = require('retry-me')
var cheerio = require('cheerio')
var csvWriter = require('csv-write-stream')
var csvParser = require('neat-csv')
var fs = require('fs')

var http = highland.wrapCallback((location, callback) => {
    var wrapper = location => {
        return callbackInner => {
            request(location, (error, response) => {
                var failure = error ? error : (response.statusCode >= 400) ? new Error(response.statusCode) : null
                callbackInner(failure, response)
            })
        }
    }
    retryMe(wrapper(location), callback)
})

var timestamp = new Date().toISOString()

var pages = [
    'http://www.viagogo.co.uk/London/Royal-Albert-Hall-Tickets/_V-438',
    'http://www.viagogo.co.uk/London/The-O2-arena-Tickets/_V-1364',
    'http://www.viagogo.co.uk/London/Eventim-Apollo-Tickets/_V-818',
    'http://www.viagogo.co.uk/Manchester/Manchester-Arena-Tickets/_V-841',
    'http://www.viagogo.co.uk/London/O2-Academy-Brixton-Tickets/_V-1148',
    'http://www.viagogo.co.uk/London/O2-Shepherds-Bush-Empire-Shepherds-Bush-Empire-Tickets/_V-400',
    'http://www.viagogo.co.uk/London/Wembley-Stadium-Tickets/_V-468'
]

function dates(response) {
    console.log('Running Viagogo at ' + timestamp + '...')
    var document = cheerio.load(response.body)
    return document('tr .txtr a').get().map(row => 'http://' + response.request.host + cheerio(row).attr('href'))
}

function pagination(response) {
    var document = cheerio.load(response.body)
    var pageList = Array.apply(null, { length: Number(document('.js-page-y').text()) }).map(Number.call, Number).map(page => page + 1)
    return pageList.map(page => response.request.href + '/page-' + page)
}

function listings(response) {
    var document = cheerio.load(response.body)
    var zones = {}
    document('#v-ed-area li').get().map(zone => {
	var zoneData = cheerio.load(zone)
	zones[zoneData('label').attr('class').split(' ')[5]] = zoneData('span').text()
    })
    return document('tbody tr').get().map(listing => {
	var listingData = cheerio.load(listing)
        return {
            timestamp: timestamp,
            event: document('h1').text(),
            eventVenue: document('.cMgry').text(),
            eventDate: new Date(document('.dbk .DD').text() + '/' + document('.dbk .mm').text() + '/' + document('.bcrmb span').text().split('/')[2] + ' ' + document('.dbk .cLgry').text()).toISOString(),
            eventOnSaleDate: '(not listed)',
	    id: listingData('.js-buy-button').attr('href').match(/ListingID=(.*)&/)[1],
            zone: zones[listingData('.mapColor').attr('class').split(' ')[0]],
            section: listingData('.v-title-sml').text(),
            row: listingData('.txtc.t.s').text().trim(),
            quantityTotal: listingData('td select option[selected]').val(),
            quantityEligible: listingData('td select option').get().map(option => cheerio(option).val()).toString(),
            price: listingData('td strong').text()
        }
    })
}

const headers = [ 'timestamp', 'event', 'eventVenue', 'eventDate', 'eventOnSaleDate', 'id', 'zone', 'section', 'row', 'quantityTotal', 'quantityEligible', 'price' ]
fs.closeSync(fs.openSync('viagogo.csv', 'a')) // make sure it exists so it can be read
csvParser(fs.readFileSync('viagogo.csv'), { headers: headers }, (error, existing) => {
    if (error) throw error
    highland(pages)
	.flatMap(http)
	.flatMap(dates)
	.flatMap(http)
	.flatMap(pagination)
	.flatMap(http)
	.flatMap(listings)
	.filter(listing => existing.map(e => e.id).indexOf(listing.id) < 0)
	.errors(e => console.log('Error: ' + e.message))
	.through(csvWriter({ sendHeaders: false }))
	.pipe(fs.createWriteStream('viagogo.csv', { flags: 'a' }))
})
