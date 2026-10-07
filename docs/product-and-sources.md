# Data sources

[Documentation home](../README.md)

## Data Sources

| Source | Used for | Dataset or feed |
| --- | --- | --- |
| Toronto Fire Services (TFS) | Public active fire-service calls, dispatch times, alarm levels, and vehicle assignments when supplied. | [Active incidents XML](https://www.toronto.ca/data/fire/livecad.xml) |
| Toronto Police Service (TPS) | Public police calls, reported divisions, incident descriptions, and approximate coordinates. | [Calls for Service ArcGIS layer](https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO/FeatureServer/0) |
| City of Toronto Road Restrictions | Road restrictions, schedules, impacts, and map geometry. | [Dataset](https://open.toronto.ca/dataset/road-restrictions/) · [JSON feed](https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json) |
| Toronto Transit Commission (TTC) | Service alerts, affected routes/stops, active periods, and stop coordinates used for geographic relevance. | [GTFS-Realtime alerts](https://gtfsrt.ttc.ca/alerts/all?format=text) · [TTC Routes and Schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/) |
| TPS police division boundaries | Division boundary overlay, station information, and geographic division estimates for TFS calls. | [TPS_POLICE_DIVISIONS_REV on ArcGIS](https://www.arcgis.com/home/item.html?id=fdd36b8dd9544c97b926958f3eb8cb98) |
| City of Toronto Centreline | Street intersections and segments used to resolve TFS location descriptions. | [Toronto Centreline](https://open.toronto.ca/dataset/toronto-centreline-tcl/) |
| GeoNames | Approximate postal-area locations and area names for Toronto postal prefixes. | [Postal data](https://www.geonames.org/postal-codes/) |
| OpenStreetMap contributors | Background map tiles and geographic context. | [OpenStreetMap](https://www.openstreetmap.org/) · [Attribution](https://www.openstreetmap.org/copyright) |

Source credits and licensing information are listed in [Attribution](attribution.md).

## Malformed source data

> [!WARNING]
> Source feeds can contain malformed data. SirenTO currently marks an unparseable feed unavailable and retains its last successful data where available; this does not mean there are zero results.
>
> Encoding repair is planned, but is not implemented. If SirenTO repairs malformed source data, it must clearly identify the alteration and affected-record count. Such a repair is made by SirenTO, not the source provider, and must preserve the source content without inventing information. Data that cannot be repaired safely must remain unavailable.
