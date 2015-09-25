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
    'https://www.stubhub.co.uk/wembley-stadium-tickets/',
    'https://www.stubhub.co.uk/twickenham-stadium-tickets/',
    'https://www.stubhub.co.uk/millenium-centre-tickets/',
    'https://www.stubhub.co.uk/hyde-park-tickets/',
    'https://www.stubhub.co.uk/the-o2-tickets/',
    'https://www.stubhub.co.uk/phones-4u-arena-manchester-tickets/',
    'https://www.stubhub.co.uk/first-direct-arena-tickets/',
    'https://www.stubhub.co.uk/wembley-stadium-tickets/',
    'https://www.stubhub.co.uk/motorpoint-arena-sheffield-tickets/',
    'https://www.stubhub.co.uk/sse-hydro-arena-glasgow-tickets/',
    'https://www.stubhub.co.uk/london-royal-albert-hall-tickets/',
    'https://www.stubhub.co.uk/eventim-apollo-tickets/',
    'https://www.stubhub.co.uk/o2-academy-brixton-tickets/',
    'https://www.stubhub.co.uk/o2-academy-birmingham-tickets/',
    'https://www.stubhub.co.uk/o2-shepherds-bush-empire-tickets/',
    'https://www.stubhub.co.uk/o2-apollo-manchester-tickets/',
    'https://www.stubhub.co.uk/london-palladium-tickets/',
    'https://www.stubhub.co.uk/royal-opera-house-tickets/',
    'https://www.stubhub.co.uk/royal-festival-hall-tickets/',
    'https://www.stubhub.co.uk/barbican-hall-london-tickets/',
    'https://www.stubhub.co.uk/london-coliseum-tickets/'
]

function dates(response) {
    var document = cheerio.load(response.body)
    return document('.dataTable .eventName a').get().map(date => {
	const location = cheerio(date).attr('href')
	const id = location.split('-').pop().slice(0, -1)
	return {
	    gzip: true,
	    uri: 'https://www.stubhub.co.uk/ticketAPI/restSvc/event/' + id,
	    also: location
	}
    })
}

function listings(response) {
    const event = JSON.parse(response.body).eventTicketListing
    return event.eventTicket.map(listing => {
        return {
	    uri: response.request.also + '?ticket_id=' + listing.id,
	    also: {
		timestamp: timestamp,
		event: '-', // filled in after
		eventVenue: '-', // filled in after
		eventDate: '-', // filled in after
		eventOnSaleDate: '(not listed)',
		id: listing.id,
		zone: listing.zn,
		section: listing.va,
		row: listing.rd,
		quantityTotal: listing.qt,
		quantityEligible: Array.from(new Array(listing.qt)).map((_, i) => i + 1).filter(i => i % listing.sq === 0).toString(),
		price: listing.tc.currency + ' ' + listing.tc.amount,
		faceValue: '-' // filled in after
            }
	}
    })
}

function purchase(response) {
    var document = cheerio.load(response.body)
    var listing = response.request.also
    listing.event = document('#eventTitleInfo').text()
    listing.eventVenue = document('.eventInfoDateTime').text().split(/at|in/)[1].trim()
    listing.eventDate = new Date(document('#ticketEventDate').text() + '/' + document('#ticketEventMonth').text().trim() + '/' + '2015' + ' ' + document('.eventInfoDateTime').text().split(' ')[1].trim()).toISOString()
    listing.faceValue = document('.deliveryDescHelpInfo .domain-price').text()
    return listing
}

const headers = [ 'timestamp', 'event', 'eventVenue', 'eventDate', 'eventOnSaleDate', 'id', 'zone', 'section', 'row', 'quantityTotal', 'quantityEligible', 'price' ]
fs.closeSync(fs.openSync('stubhub.csv', 'a')) // make sure it exists so it can be read
csvParser(fs.readFileSync('stubhub.csv'), { headers: headers }, (error, existing) => {
    if (error) throw error
    highland(pages)
	.flatMap(http)
	.flatMap(dates)
	.flatMap(http)
	.flatMap(listings)
	.flatMap(http)
	.map(purchase)
	.filter(listing => existing.map(e => e.id).indexOf(listing.id) < 0)
	.errors(e => console.log('Error: ' + e.message))
	.through(csvWriter({ sendHeaders: false }))
        .pipe(fs.createWriteStream('stubhub.csv', { flags: 'a' }))
})
