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
    'http://www.viagogo.co.uk/London/Wembley-Stadium-Tickets/_V-468',
    'http://www.viagogo.co.uk/London/Twickenham-Stadium-Tickets/_V-144',
    'http://www.viagogo.co.uk/Cardiff/Millennium-Stadium-Tickets/_V-143',
    'http://www.viagogo.co.uk/London/Hyde-Park-Tickets/_V-278',
    'http://www.viagogo.co.uk/London/The-O2-arena-Tickets/_V-1364',
    'http://www.viagogo.co.uk/Manchester/Manchester-Arena-Tickets/_V-841',
    'http://www.viagogo.co.uk/Leeds/First-Direct-Arena-Tickets/_V-18370',
    'http://www.viagogo.co.uk/London/Wembley-Stadium-Tickets/_V-468',
    'http://www.viagogo.co.uk/Cardiff/Motorpoint-Arena-Cardiff-Tickets/_V-190',
    'http://www.viagogo.co.uk/Glasgow/Hydro-Tickets/_V-18244',
    'http://www.viagogo.co.uk/London/Royal-Albert-Hall-Tickets/_V-438',
    'http://www.viagogo.co.uk/London/Eventim-Apollo-Tickets/_V-818',
    'http://www.viagogo.co.uk/London/O2-Academy-Brixton-Tickets/_V-1148',
    'http://www.viagogo.co.uk/Birmingham/O2-Academy-Birmingham-Tickets/_V-191',
    'http://www.viagogo.co.uk/London/O2-Shepherds-Bush-Empire-Shepherds-Bush-Empire-Tickets/_V-400',
    'http://www.viagogo.co.uk/Manchester/O2-Apollo-Manchester-Tickets/_V-844',
    'http://www.viagogo.co.uk/West-End/London-Palladium-Tickets/_V-306',
    'http://www.viagogo.co.uk/West-End/Royal-Opera-House-Tickets/_V-391',
    'http://www.viagogo.co.uk/West-End/Royal-Festival-Hall-Tickets/_V-388',
    'http://www.viagogo.co.uk/London/Barbican-Centre-Tickets/_V-164',
    'http://www.viagogo.co.uk/Manchester/Oldham-Coliseum-Theatre-Tickets/_V-21277'
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
    listing.faceValue = document('.pipelinesidebar').text().trim().match(/\r\n(.*)/)[1]
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
