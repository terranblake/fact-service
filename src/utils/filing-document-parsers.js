const { Fact, Link } = require('@postilion/models');
const { logger } = require('@postilion/utils');

const {
    formatFacts,
    formatUnits,
    formatContexts,
    formatLinkbaseArcs,
    formatLinkbaseLocators
} = require('./filing-document-formatters');

module.exports = {
    instance: async (elements, filingId, company) => {
        elements = elements['xbrli:xbrl'] || elements.xbrl;

        let rawUnits = elements['xbrli:unit'] || elements.unit;;
        const formattedUnits = formatUnits(rawUnits);

        const rawContexts = elements['xbrli:context'] || elements.context;
        const formattedContexts = await formatContexts(rawContexts);

        const newFacts = await formatFacts(elements, formattedContexts, formattedUnits, filingId, company);
        logger.info(`found ${newFacts && newFacts.length} new facts from filing ${filingId} company ${company}`);
        for (let fact of newFacts) {
            await Fact.create(fact);
        }

        return newFacts;
    },
    calculation: async (elements, filing, company) => {
        return await formatNamedLinkbase(elements, filing, company, 'calculation');
    },
    definition: async (elements, filing, company) => {
        return await formatNamedLinkbase(elements, filing, company, 'definition');
    },
    label: async (elements, filing, company) => {
        return await formatNamedLinkbase(elements, filing, company, 'label');
    },
    presentation: async (elements, filing, company) => {
        return await formatNamedLinkbase(elements, filing, company, 'presentation');
    }
}

async function formatNamedLinkbase(elements, filing, company, documentType) {
    elements = elements['link:linkbase'] || elements.linkbase;

    let formattedLinks = [];
    const links = elements[`link:${documentType}Link`] || elements[`${documentType}Link`];
    for (let link of links) {
        const linkRole = link.$['xlink:role'];
        const name = linkRole.split('/').pop();

        // format calculation arcs
        const arcs = link[`link:${documentType}Arc`] || [];
        const formattedArcs = formatLinkbaseArcs(name, arcs);
        formattedLinks = formattedLinks.concat(formattedArcs);

        // format calculation locators
        const locators = link['link:loc'] || [];
        const formattedLocators = formatLinkbaseLocators(name, locators);
        formattedLinks = formattedLinks.concat(formattedLocators);
    }

    for (let link of formattedLinks) {
        await Link.create({ ...link, filing, company, documentType });
    }

    return formattedLinks;
}