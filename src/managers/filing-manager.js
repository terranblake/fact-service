const request = require('request');
const { promisify } = require('util');
const { readFile } = require('fs');
const { parseString } = require('xml2js');

const requestAsync = promisify(request);
const readFileAsync = promisify(readFile);
const parseStringAsync = promisify(parseString);

const { enums, logger, parserOptions } = require('@postilion/utils');
const { filingDocumentParsingOrder } = enums;

const filingDocumentParsers = require('../utils/filing-document-parsers');

const { Filing, FilingDocument, Company } = require('@postilion/models');

class FilingManager {
	constructor() { }

	// lookup all filing documents and parse facts
	// from each as necessary
	async getFactsFromFiling(job) {
		const { _id, company, publishedAt, refId } = job.data;

		await Filing.findOneAndUpdate({ _id }, { status: 'crawling' });
		const documents = await FilingDocument.find(
			{
				filing: _id,
				type: {
					$in: Object.keys(filingDocumentParsers)
				}
			},
			{
				_id: 1,
				type: 1
			}
		).lean();

		logger.info(`found ${documents && documents.length} documents from filing ${_id} company ${company}`);
		const companyObj = await Company.findOne({ _id: company }).lean();

		// iterate through filing documents in order of document
		// requirements enforced by the parsing order enum
		// this ensures that we aren't parsing a document without
		// prerequisite information needed to parse the document
		// to it's entirety and extract all relevant facts
		for (let i of Object.keys(filingDocumentParsingOrder)) {
			const documentType = filingDocumentParsingOrder[i];

			const filteredDocuments = documents.filter(d => d.type === documentType);
			if (!filteredDocuments.length) {
				logger.warn(`no documents found for type ${documentType} for filing ${_id} publishedAt ${publishedAt} company ${company}`);
				continue;
			}

			for (let document of filteredDocuments) {
				await FilingManager.prototype.getFactsFromFilingDocument(document._id, refId, companyObj.ticker);
			}
		}

		await Filing.findOneAndUpdate({ _id }, { status: 'crawled' });
	}

	// singular form of getFactsFromFiling. simply gets all of the facts from a document
	async getFactsFromFilingDocument(documentId, refId, ticker) {
		const document = await FilingDocument.findOne({ _id: documentId });
		const { fileUrl, company, status, fileName, _id, filing, type } = document;
		let elements;

		logger.info(`crawling filingDocument ${_id} type ${type} for facts company ${company} filing ${filing}`);

		// read from local archive if exists
		if (process.env.ARCHIVE_LOCATION && ['downloaded', 'crawled'].includes(status)) {
			logger.info(`filingDocument ${_id} loaded from local archive since it has been downloaded company ${company} filing ${filing}`);

			const archiveLocation = `${process.env.ARCHIVE_LOCATION}/${ticker}/${refId}/${fileName}`;
			elements = await readFileAsync(archiveLocation);
			// otherwise download the document again
		} else {
			logger.info(`filingDocument ${_id} downloaded from source since it has not been downloaded company ${company} filing ${filing}`);
			const response = await requestAsync({ url: fileUrl, method: 'GET' });
			elements = response.body;
		}

		await FilingDocument.findOneAndUpdate({ _id }, { status: 'crawling' });

		elements = await parseStringAsync(elements, parserOptions.filingDocument);

		// get the parser associated with the type of filing document
		const filingDocumentParser = filingDocumentParsers[type];
		await filingDocumentParser(elements, filing, company);

		const updatedDocument = await FilingDocument.findOneAndUpdate({ _id }, { status: 'crawled' });
		logger.info(`finished crawling filingDocument ${_id} type ${type} for facts company ${company} filing ${filing}`);
	}
}

module.exports = FilingManager;