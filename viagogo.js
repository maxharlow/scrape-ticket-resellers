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
            request.defaults({ jar: true })(location, (error, response) => {
                var failure = error ? error : (response.statusCode >= 400) ? new Error(response.statusCode) : null
                callbackInner(failure, response)
            })
        }
    }
    retryMe(wrapper(location), callback)
})

var pages = [
    'http://www.viagogo.co.uk/Concert-Tickets/Alternative-and-Indie/Muse-Tickets',
    'http://www.viagogo.co.uk/Theatre-Tickets/Ballet-and-Dance/Riverdance-Tickets',
    'http://www.viagogo.co.uk/Concert-Tickets/Rock-and-Pop/Rod-Stewart-Tickets',
    'http://www.viagogo.co.uk/Concert-Tickets/Alternative-and-Indie/John-Grant-Tickets',
    'http://www.viagogo.co.uk/Concert-Tickets/Club-and-dance/Disclosure-Tickets'
]

function dates(response) {
    console.log('Viagogo: ' + new Date().toISOString() + ' - running ' + response.request.href + '...')
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
	    uri: listingData('.js-buy-button').attr('href'),
	    also: {
		timestamp: new Date().toISOString(),
		event: document('h1').text(),
		eventVenue: document('.cMgry').text(),
		eventDate: document('.dbk').get().length === 0 ? document('.bk.cMgry').text() : new Date(document('.dbk .DD').text() + '/' + document('.dbk .mm').text() + '/' + document('.bcrmb span').text().split('/')[2] + ' ' + document('.dbk .cLgry').text()).toISOString(),
		eventOnSaleDate: '(not listed)',
		id: listingData('.js-buy-button').attr('href').match(/ListingID=(.*)&/)[1],
		zone: zones[listingData('.mapColor').attr('class').split(' ')[0]],
		section: listingData('.v-title-sml').text(),
		row: listingData('.txtc.t.s').text().trim(),
		quantityTotal: listingData('td select option[selected]').val(),
		quantityEligible: listingData('td select option').get().map(option => cheerio(option).val()).toString(),
		price: listingData('td strong').text(),
		faceValue: '-' // filled in after
            }
	}
    })
}

function purchase(response) {
    var document = cheerio.load(response.body)
    var listing = response.request.also
    if (!!response.request.href.match(/Abandon/g)) throw new Error('Abandoned - ' + document('h4').text())
    if (document('.pipelinesidebar').text() === '')  listing.faceValue = '(unlisted)'
    else listing.faceValue = document('.pipelinesidebar').text().trim().match(/\r\n(.*)/)[1]
    return listing
}

const headers = [ 'timestamp', 'event', 'eventVenue', 'eventDate', 'eventOnSaleDate', 'id', 'zone', 'section', 'row', 'quantityTotal', 'quantityEligible', 'price' ]
fs.closeSync(fs.openSync('viagogo.csv', 'a')) // make sure it exists so it can be read
csvParser(fs.readFileSync('viagogo.csv'), { headers: headers }, (error, existing) => {
    if (error) throw error
    const existingIDs = existing.map(e => e.id)
    highland(pages)
	.flatMap(http)
	.flatMap(dates)
	.flatMap(http)
	.flatMap(pagination)
	.flatMap(http)
	.flatMap(listings)
	.flatMap(http)
	.map(purchase)
	.filter(listing => existingIDs.indexOf(listing.id) < 0)
	.errors(e => console.log('Error: ' + e.stack))
	.through(csvWriter({ sendHeaders: false }))
	.pipe(fs.createWriteStream('viagogo.csv', { flags: 'a' }))
})
