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

var pages = [
    'http://www.seatwave.com/muse-tickets/season',
    'http://www.seatwave.com/riverdance-tickets/season',
    'http://www.seatwave.com/rod-stewart-tickets/season',
    'http://www.seatwave.com/john-grant-tickets/season',
    'http://www.seatwave.com/disclosure-tickets/season',
    'http://www.seatwave.com/barry-manilow-tickets/season'
]

function performances(response) {
    console.log('Seatwave: ' + new Date().toISOString() + ' - running ' + response.request.href + '...')
    var document = cheerio.load(response.body)
    return document('#local-tickets tr[data-where]').get().map(row => {
	var rowData = cheerio.load(row)
	var performance = rowData('a.performance').attr('href').split('/')[5]
	return {
	    uri: 'http://www.seatwave.com/performance/allpostings?performanceId=' + performance,
	    also: {
		event: rowData('a.performance strong').text(),
		eventVenue: rowData('a.performance .venue').text(),
		eventDate: new Date(rowData('[datetime]').attr('datetime')).toISOString()
	    }
	}
    })
}

function listings(response) {
    var data = JSON.parse(response.body)
    return data.map(listing => {
        return {
	    timestamp: new Date().toISOString(),
	    event: response.request.also.event,
	    eventVenue: response.request.also.eventVenue,
	    eventDate: response.request.also.eventDate,
	    eventOnSaleDate: '(not listed)',
	    id: listing.Id,
	    zone: listing.TypeName,
	    section: listing.SectionAndRow,
	    row: '(included in section)',
	    quantityTotal: listing.TotalNumberOfTicketsAvailable,
	    quantityEligible: listing.AvailableTicketQuantities.map(q => q.Text).toString(),
	    price: listing.PricePerTicketDisplay[0] + listing.CurrencyDecimalSeparator + listing.PricePerTicketDisplay[1],
	    faceValue: listing.FaceValue
        }
    })
}

const headers = [ 'timestamp', 'event', 'eventVenue', 'eventDate', 'eventOnSaleDate', 'id', 'zone', 'section', 'row', 'quantityTotal', 'quantityEligible', 'price' ]
fs.closeSync(fs.openSync('seatwave.csv', 'a')) // make sure it exists so it can be read
csvParser(fs.readFileSync('seatwave.csv'), { headers: headers }, (error, existing) => {
    if (error) throw error
    highland(pages)
	.flatMap(http)
	.flatMap(performances)
	.flatMap(http)
	.flatMap(listings)
	.filter(listing => existing.map(e => e.id).indexOf(listing.id) < 0)
	.errors(e => console.log('Error: ' + e.stack))
	.through(csvWriter({ sendHeaders: false }))
        .pipe(fs.createWriteStream('seatwave.csv', { flags: 'a' }))
})
