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
    'http://www.getmein.com/venues/wembley-stadium.html',
    'http://www.getmein.com/venues/twickenham-stadium.html',
    'http://www.getmein.com/venues/millennium-stadium.html',
    'http://www.getmein.com/venues/hyde-park.html',
    'http://www.getmein.com/venues/the-o2.html',
    'http://www.getmein.com/venues/manchester-arena.html',
    'http://www.getmein.com/venues/first-direct-arena.html',
    'http://www.getmein.com/venues/the-sse-arena-wembley.html',
    'http://www.getmein.com/venues/motorpoint-arena-sheffield.html',
    'http://www.getmein.com/venues/royal-albert-hall.html',
    'http://www.getmein.com/venues/eventim-apollo.html',
    'http://www.getmein.com/venues/carling-academy-brixton.html',
    'http://www.getmein.com/venues/o2-academy-birmingham.html',
    'http://www.getmein.com/venues/shepherds-bush-empire.html',
    'http://www.getmein.com/venues/o2-apollo.html',
    'http://www.getmein.com/venues/london-palladium.html',
    'http://www.getmein.com/venues/royal-opera-house.html',
    'http://www.getmein.com/venues/royal-festival-hall.html',
    'http://www.getmein.com/venues/barbican-theatre-london.html',
    'http://www.getmein.com/venues/coliseum-theatre.html'
]

function dates(response) {
    console.log('Get Me In: ' + new Date().toISOString() + ' - running ' + response.request.href + '...')
    var document = cheerio.load(response.body)
    return document('[data-click=event] .event a').get().map(row => 'http://' + response.request.host + cheerio(row).attr('href'))
}

function listings(response) {
    var document = cheerio.load(response.body)
    var details = JSON.parse(document('#event-details-json').text()).details
    var data = JSON.parse(document('#ticket-listing-json').text()).listings.filter(listing => listing.type === 'Offer')
    return data.map(listing => {
        return {
	    method: 'POST',
	    url: 'http://' + response.request.host + listing.url,
	    followAllRedirects: true,
	    form: {
		quantity: listing.inventoryLevel,
		ticketid: listing.id,
		baseprice: listing.priceDisplay
	    },
	    also: {
		timestamp: new Date().toISOString(),
		event: details.EventName,
		eventVenue: details.Venue.trim(),
		eventDate: details.ShowDate,
		eventOnSaleDate: details.OnSaleDate,
		id: listing.id,
		zone: listing.ISMZoneName,
		section: listing.section,
		row: listing.row,
		quantityTotal: listing.inventoryLevel,
		quantityEligible: listing.eligibleQuantity.toString(),
		price: listing.priceDisplayCurrency + listing.priceDisplay,
		faceValue: '-' // filled in after
            }
	}
    })
}

function purchase(response) {
    var listing = response.request.also
    listing.faceValue = response.body.match(/The original face value price of each ticket is (.*) as indicated by the seller/)[1]
    return listing
}

const headers = [ 'timestamp', 'event', 'eventVenue', 'eventDate', 'eventOnSaleDate', 'id', 'zone', 'section', 'row', 'quantityTotal', 'quantityEligible', 'price' ]
fs.closeSync(fs.openSync('get-me-in.csv', 'a')) // make sure it exists so it can be read
csvParser(fs.readFileSync('get-me-in.csv'), { headers: headers }, (error, existing) => {
    if (error) throw error
    const existingIDs = existing.map(e => e.id)
    highland(pages)
	.flatMap(http)
	.flatMap(dates)
	.flatMap(http)
	.flatMap(listings)
	.flatMap(http)
	.map(purchase)
	.filter(listing => existingIDs.indexOf(listing.id) < 0)
	.errors(e => console.log('Error: ' + e.message))
	.through(csvWriter({ sendHeaders: false }))
	.pipe(fs.createWriteStream('get-me-in.csv', { flags: 'a' }))    
})
