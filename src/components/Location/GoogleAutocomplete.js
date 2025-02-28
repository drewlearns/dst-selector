/*
  google maps component which leaflet is wrapped around
  fetchLocationDetails fetches location data
  styled using makeStyles
*/

import Grid from '@mui/material/Grid';
import makeStyles from '@mui/styles/makeStyles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import Autocomplete from '@mui/material/Autocomplete';
import parse from 'autosuggest-highlight/parse';
import throttle from 'lodash/throttle';
import React, { useContext, useEffect } from 'react';
import { googleApiKey } from '../../shared/keys';
import { Context } from '../../store/Store';

const isNum = (val) => {
  return /^\d+$/.test(val);
};

function loadScript(src, position, id) {
  if (!position) {
    return;
  }

  const script = document.createElement('script');
  script.setAttribute('async', '');
  script.setAttribute('id', id);
  script.src = src;
  position.appendChild(script);
}

const autocompleteService = { current: null };
const placeService = { current: null };

const useStyles = makeStyles((theme) => ({
  icon: {
    color: theme.palette.text.secondary,
    marginRight: theme.spacing(2),
  },
}));

export default function GoogleAutocomplete({
  mapInstance,
  mapsApi,
  latLng,
  setLatLng,
  searchLabel = 'FIND YOUR LOCATION',
  setAddress,
  setCounty,
  selectedToEditSite,
  setSelectedToEditSite,
}) {
  const { state, dispatch } = useContext(Context);
  const classes = useStyles();
  const [value, setValue] = React.useState(null);
  const [inputValue, setInputValue] = React.useState(state.fullAddress ? state.fullAddress : '');
  const [options, setOptions] = React.useState([]);
  const loaded = React.useRef(false);

  useEffect(() => {
    if (state.addressChangedViaMap) {
      setValue(state.fullAddress);
    }
  }, [state.addressChangedViaMap, state.fullAddress]);

  useEffect(() => {
    setValue(state.fullAddress);
  }, [state.fullAddress]);

  if (typeof window !== 'undefined' && !loaded.current) {
    if (!document.querySelector('#google-maps')) {
      loadScript(
        `https://maps.googleapis.com/maps/api/js?key=${googleApiKey}&libraries=places`,
        document.querySelector('head'),
        'google-maps',
      );
    }

    loaded.current = true;
  }

  const fetchData = React.useMemo(
    () =>
      throttle((request, callback) => {
        autocompleteService.current.getPlacePredictions(request, callback);
      }, 200),
    [],
  );

  const fetchLocalData = {
    load: (place_id, main_text) => {
      fetchLocalData.fetchPlaces(place_id).then((res) => {
        fetchLocalData.setData(res, main_text);
      });
    },
    fetchPlaces: async (place_id) => {
      placeService.current = new window.google.maps.Geocoder();
      const placeRequest = {
        placeId: place_id,
        region: 'en-US',
      };
      return await new Promise((resolve) =>
        placeService.current.geocode(placeRequest, (results, status) => {
          resolve({ results, status });
        }),
      );
    },
    fetchZipFromLatLng: async (lat, lng) => {
      const geocoder = new window.google.maps.Geocoder();
      const latlng = new window.google.maps.LatLng(lat, lng);

      return geocoder.geocode({ latLng: latlng });
    },
    setData: async ({ results, status }, main_text) => {
      if (status === 'OK') {
        const county = results[0].address_components.filter(
          (e) => e.types[0] === 'administrative_area_level_2',
        );
        let zipCode = results[0].address_components.filter((e) => e.types[0] === 'postal_code');

        if (zipCode.length === 0) {
          const lonCenter = results[0].geometry.location.lng();
          const latCenter = results[0].geometry.location.lat();

          fetchLocalData.fetchZipFromLatLng(latCenter, lonCenter).then((zip) => {
            let zipCode = zip.results[0].address_components.filter(
              (e) => e.types[0] === 'postal_code',
            );
            if (county.length !== 0) {
              // If google is able to find the county, pick the first preference!
              fetchLocalData.fetchGeocode(results, county, main_text, zipCode);
            } else {
              fetchLocalData.fetchGeocode(results, '', main_text, zipCode);
            }
          });
        } else if (county.length !== 0) {
          // If google is able to find the county, pick the first preference!
          fetchLocalData.fetchGeocode(results, county, main_text, zipCode);
        } else {
          fetchLocalData.fetchGeocode(results, '', main_text, zipCode);
        }
      } else {
        console.error('Google PlaceService Status', status);
      }
    },
    fetchGeocode: (results, county, main_text, zipCode) => {
      county = county || [{}];

      dispatch({
        type: 'CHANGE_ADDRESS_VIA_MAP',
        data: {
          address: results[0].formatted_address.split(',')[0],
          fullAddress: results[0].formatted_address,
          addressVerified: true,
        },
      });

      if (zipCode.length === 0) {
        setSelectedToEditSite({
          ...selectedToEditSite,
          latitude: results[0].geometry.location.lat(),
          longitude: results[0].geometry.location.lng(),
          county: county[0].long_name,
          address: main_text,
          zipCode: 0,
        });
      } else {
        setSelectedToEditSite({
          ...selectedToEditSite,
          latitude: results[0].geometry.location.lat(),
          longitude: results[0].geometry.location.lng(),
          county: county[0].long_name,
          address: main_text,
          zipCode: parseInt(zipCode[0].long_name),
        });
      }
    },
  };

  const fetchLocationDetails = ({ place_id, structured_formatting }) => {
    if (place_id) {
      fetchLocalData.load(place_id, structured_formatting.main_text);
    }
  };

  useEffect(() => {
    let active = true;

    if (!autocompleteService.current && window.google) {
      autocompleteService.current = new window.google.maps.places.AutocompleteService();
    }
    if (!autocompleteService.current) {
      return undefined;
    }

    if (inputValue === '') {
      setOptions(value ? [value] : []);
      return undefined;
    }

    if (isNum(inputValue) && inputValue.length >= 3) {
      //  probably a zip code?
      fetchData(
        {
          input: inputValue,
          types: ['(regions)'],
          componentRestrictions: { country: 'US' },
        },
        (results) => {
          if (active) {
            let newOptions = [];

            if (value) {
              newOptions = [value];
            }

            if (results) {
              newOptions = [...newOptions, ...results];
            }

            setOptions(newOptions);
          }
        },
      );
    } else {
      fetchData(
        {
          input: inputValue,

          componentRestrictions: { country: 'US' },
        },
        (results) => {
          if (active) {
            let newOptions = [];

            if (value) {
              newOptions = [value];
            }

            if (results) {
              newOptions = [...newOptions, ...results];
            }

            setOptions(newOptions);
          }
        },
      );
    }

    return () => {
      active = false;
    };
  }, [value, inputValue, fetchData]);

  return (
    /*
     * RICK'S NOTE:
     * This causes a "ghost" effect on FIND YOUR LOCATION:
     *   style={{ zIndex: 1000003 }}
     * Doesn't seem to be needed.
     * TODO: Remove after 5/1/2022
     */

    <Autocomplete
      id="google-map-demo"
      fullWidth
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.description)}
      filterOptions={(x) => x}
      options={options}
      autoComplete
      includeInputInList
      filterSelectedOptions
      value={value}
      onChange={(event, newValue) => {
        setOptions(newValue ? [newValue, ...options] : options);
        setValue(newValue);
        // fetch location details
        if (newValue) {
          fetchLocationDetails(newValue);
        }
      }}
      onInputChange={(event, newInputValue) => {
        setInputValue(newInputValue);
      }}
      renderInput={(params) => {
        return <TextField {...params} label={searchLabel} variant="filled" fullWidth />;
      }}
      renderOption={(option) => {
        let matches = [];
        let parts = [];
        if (option.structured_formatting) {
          matches = option.structured_formatting.main_text_matched_substrings;

          parts = parse(
            option.structured_formatting.main_text,
            matches.map((match) => [match.offset, match.offset + match.length]),
          );
        }

        return (
          <Grid container alignItems="center">
            <Grid item>
              <LocationOnIcon className={classes.icon} />
            </Grid>
            <Grid item xs>
              {parts.map((part, index) => (
                <span key={index} style={{ fontWeight: part.highlight ? 700 : 400 }}>
                  {part.text}
                </span>
              ))}

              <Typography variant="body2" color="textSecondary">
                {option.structured_formatting ? option.structured_formatting.secondary_text : ''}
              </Typography>
            </Grid>
          </Grid>
        );
      }}
    />
  );
}
