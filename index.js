const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
require('dotenv').config();

const URL = 'https://tickets.wbstudiotour.co.uk/webstore/shop/viewitems.aspx?c=tix2&cg=hptst2';
const CHECK_INTERVAL_MINUTES = process.env.CHECK_INTERVAL_MINUTES; 
const MONTH_WANTED = process.env.MONTH_WANTED; 
const DATES_WANTED = process.env.DATES_WANTED;
const ADULT_TICKETS_WANTED = process.env.ADULT_TICKETS_WANTED;
const MIN_HOUR=process.env.MIN_HOUR;
const MAX_HOUR=process.env.MAX_HOUR;

async function sendEmailNotification(availableDates) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: `"HP Ticket Bot" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO,
    subject: '🎟️ Warner Bros Studio Tour Tickets Available!',
    text: `Tickets available on: ${availableDates.join(', ')}\n\nLink: ${URL}`
  });

  console.log('📧 Email sent!');
}

async function setAdultTickets(page, adultTicketsWanted) {
  await page.waitForSelector('.quantity-control.row > input');
  const adultTicketsCount = await page.$eval('.quantity-control.row > input', el => parseInt(el.value, 10));

  const diff = adultTicketsWanted - adultTicketsCount;
  if (diff === 0) return;

  const buttonSelector = `.quantity-control.row > button.typcn-${diff > 0 ? 'plus' : 'minus'}`;
  const button = await page.$(buttonSelector);

  for (let i = 0; i < Math.abs(diff); i++) {
    await button.click();
	await new Promise(resolve => setTimeout(resolve, 300));
  }
}

async function waitForAvailability(page, monthWanted) {
  await new Promise(resolve => setTimeout(resolve, 1000));

  const isLoading = await page.evaluate(() => {
    return document.querySelectorAll('.calendar-modal[data-component=eventTimeModal] .modal-content > .loading-mask.hide').length === 0;
  });
  console.log(`loading`,isLoading);
  if (isLoading) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return waitForAvailability(page, monthWanted);
  }

  if (monthWanted == null) {
    const availableEls = await page.$$('.calendar>.row:not(.blankLoader) .calendar-body .day.available');
    return { availableEls };
  }

  const monthValue = await page.$eval(
    '[name="ctl00$ContentPlaceHolder$SalesChannelDetailControl$EventsDateTimeSelectorModal$EventsDateTimeSelector$CalendarSelector$MonthDropDownList"]',
    el => el.value
  );
  const month = parseInt(monthValue.replace(/^\D+/g, ''), 10);

  if (month < monthWanted) {
    console.log(`Month too early (${month}) - next month...`);
    await page.click('[name="ctl00$ContentPlaceHolder$SalesChannelDetailControl$EventsDateTimeSelectorModal$EventsDateTimeSelector$CalendarSelector$NextMonthImageButton"]');
    await new Promise(resolve => setTimeout(resolve, 2000));
    return waitForAvailability(page, monthWanted);
  }

  const availableEls = await page.$$('.calendar>.row:not(.blankLoader) .calendar-body .day.available');
  return { availableEls, month };
}

async function addTicketsToBasket(page, dayElement) {
  await dayElement.click();
  await new Promise(resolve => setTimeout(resolve, 2000));
  const timeRows = await page.$$('.time-selector .times .time.row');
  if (timeRows.length === 0) return false;
  for (let i = 0; i < timeRows.length; i++) {
	  const row = timeRows[i];
	  const timeString = await row.$eval('.time', el => el.innerText.trim());
	  console.log(`Found available time slot ${timeString}`);
	  
	  const hour = parseInt(timeString.split(':')[0], 10);
		if (MIN_HOUR != null && hour < MIN_HOUR) {
			console.log(`Tickets found at wanted date but time is too early (${timeString})`);
			return false;
		}
		if (MAX_HOUR != null && hour > MAX_HOUR) {
			console.log(`Tickets found at wanted date but time is too late (${timeString})`);
			return false;
		}

		console.log('Found tickets!!!!!');
		return true;
  }

  
  await new Promise(resolve => setTimeout(resolve, 2000));
  const cartButton = await page.$('.typcn.typcn-shopping-cart.ng-binding');
  if (cartButton) await cartButton.click();
  return true;
}

async function checkForTickets(page) {
  await setAdultTickets(page, ADULT_TICKETS_WANTED);
  let tickets = false;
  const extendSessionBtn = await page.$('.ui-control.button.extendSession');
  if (extendSessionBtn) {
    console.log('Extending session...');
    await extendSessionBtn.click();
  }
  await page.click('#onetrust-accept-btn-handler'); //click for cookie
  await new Promise(resolve => setTimeout(resolve, 1000));
  await page.click('.shared-calendar-button');
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log(`📅 Checking month ${MONTH_WANTED} ...`);
  const { availableEls, month } = await waitForAvailability(page, MONTH_WANTED);
  
  console.log(`📅 Checking date ${DATES_WANTED} ...`);
  const availableDates = [];
  for (const el of availableEls) {
    const day = await page.evaluate(el => parseInt(el.innerText, 10), el);
	console.log(`🎟️ Tickets available on ${day}`);
    if (DATES_WANTED.includes(day)) {
      availableDates.push(day);
      tickets = await addTicketsToBasket(page, el);
    }
  }

  if (tickets) {
    await sendEmailNotification(availableDates);
    return true;
  }

  console.log('❌ No desired dates available.');
  return false;
}

async function startBot() {
  console.log(`🚀 Starting HP Ticket Bot at ${new Date().toLocaleString()}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2' });

  const success = await checkForTickets(page);
  await browser.close();

  if (!success) {
    console.log(`⏳ Will check again in ${CHECK_INTERVAL_MINUTES} minutes...\n`);
    setTimeout(startBot, CHECK_INTERVAL_MINUTES * 60 * 1000);
  }
}

startBot();


