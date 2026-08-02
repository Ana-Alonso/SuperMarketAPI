import { Scraper } from '../types/scraper';
import { MercadonaScraper } from './mercadona';
import { EroskiScraper } from './eroski';
import { DiaScraper } from './dia';
import { AldiScraper } from './aldi';
import { CarrefourScraper } from './carrefour';

export const scraperRegistry: Record<string, Scraper> = {
    mercadona: new MercadonaScraper(),
    eroski: new EroskiScraper(),
    dia: new DiaScraper(),
    aldi: new AldiScraper(),
    carrefour: new CarrefourScraper()
};
