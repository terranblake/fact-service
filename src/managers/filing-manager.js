const request = require('request');
const { promisify } = require('util');
const { readFile } = require('fs');
const { parseString } = require('xml2js');

const requestAsync = promisify(request);
const readFileAsync = promisify(readFile);
const parseStringAsync = promisify(parseString);

const { enums, logger } = require('@postilion/utils');
const { filingDocumentParsingOrder } = enums;

const filingDocumentParsers = require('../utils/filing-document-parsers');

const { FilingDocument } = require('@postilion/models');

class FilingManager {
	constructor() { }

	// lookup all filing documents and parse facts
	// from each as necessary
	async getFactsFromFiling(job) {
		const { _id } = job.data;

		const documents = await FilingDocument
			.find({
				filing: _id,
				type: { $in: Object.keys(filingDocumentParsers) }
			})
			.lean();

		let crawledDocuments = [];

		// iterate through filing documents in order of document
		// requirements enforced by the parsing order enum
		// this ensures that we aren't parsing a document without
		// prerequisite information needed to parse the document
		// to it's entirety and extract all relevant facts
		for (let i of Object.keys(filingDocumentParsingOrder)) {
			const documentType = filingDocumentParsingOrder[i];

			const filteredDocuments = documents.filter(d => d.type === documentType);
			if (!filteredDocuments.length) {
				continue;
			}

			for (let document of filteredDocuments) {
				await this.getFactsFromFilingDocument(document._id);
			}
		}

		return crawledDocuments;
	}

	// singular form of getFactsFromFiling. simply gets all of the facts
	// from a 
	async getFactsFromFilingDocument(documentId) {
		const document = await FilingDocument.findOne({ _id: documentId });
		const { fileUrl, company, status, statusReason, _id, filing, type } = document;
		let elements;

		// read from local archive if exists
		if (['downloaded', 'crawled'].includes(status)) {
			logger.info(`filingDocument ${_id} loaded from local archive since it has been downloaded company ${company} filing ${filing}`);
			elements = await readFileAsync(statusReason);
			// otherwise download the document again
		} else {
			logger.info(`filingDocument ${_id} downloaded from source since it has not been downloaded company ${company} filing ${filing}`);
			elements = await requestAsync({ url: fileUrl, method: 'GET' });
		}
		
		await FilingDocument.findOneAndUpdate({ _id }, { status: 'crawling' });
		elements = await parseStringAsync(elements, filingDocumentParserOptions);

		// get the parser associated with the type of filing document
		const filingDocumentParser = filingDocumentParsers[type];
		await filingDocumentParser(elements, filing, company);

		const updatedDocument = await FilingDocument.findOneAndUpdate({ _id }, { status: 'crawled' });
		logger.info(`finished crawling filingDocument ${updatedDocument._id} for facts company ${company} filing ${filing}`);
		return updatedDocument;
	}
}

module.exports = FilingManager;