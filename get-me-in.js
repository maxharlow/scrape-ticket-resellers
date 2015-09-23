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
    'http://www.getmein.com/rock-and-pop/little-mix-tickets.html'
]

function dates(response) {
    console.log('Running Get Me In at ' + timestamp + '...')
    var document = cheerio.load(response.body)
    return document('[data-click=event] .event a').get().map(row => 'http://' + response.request.host + cheerio(row).attr('href'))
}

function listings(response) {
    var document = cheerio.load(response.body)
    var details = JSON.parse(document('#event-details-json').text()).details
    var data = JSON.parse(document('#ticket-listing-json').text()).listings.filter(listing => listing.type === 'Offer')
    return data.map(listing => {
        return {
            timestamp: timestamp,
            event: details.EventName,
            eventVenue: details.Venue.trim(),
            eventVenueCity: details.VenueCity,
            eventDate: details.ShowDate,
            eventOnSaleDate: details.OnSaleDate,
	    id: listing.id,
            zone: listing.ISMZoneName,
            section: listing.section,
            row: listing.row,
            quantityTotal: listing.inventoryLevel,
            quantityEligible: listing.eligibleQuantity.toString(),
            price: listing.priceDisplayCurrency + listing.priceDisplay
        }
    })
}

const headers = [ 'timestamp', 'event', 'eventVenue', 'eventVenueCity', 'eventDate', 'eventOnSaleDate', 'id', 'zone', 'section', 'row', 'quantityTotal', 'quantityEligible', 'price' ]
fs.closeSync(fs.openSync('get-me-in.csv', 'a')) // make sure it exists so it can be read
csvParser(fs.readFileSync('get-me-in.csv'), { headers: headers }, (error, existing) => {
    if (error) throw error
    highland(pages)
	.flatMap(http)
	.flatMap(dates)
	.flatMap(http)
	.flatMap(listings)
	.filter(listing => existing.map(e => e.id).indexOf(listing.id) < 0)
	.errors(e => console.log('Error: ' + e.message))
	.through(csvWriter({ sendHeaders: false }))
	.pipe(fs.createWriteStream('get-me-in.csv', { flags: 'a' }))    
})
