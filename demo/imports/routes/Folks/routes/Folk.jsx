import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { pure } from 'meteor/ssrwpo:ssr';

const Folk = ({ name }) => (
  <section>
    <h3>Selected</h3>
    <p><Link to="/folks">Back</Link></p>
    <p>Selected folk: {name}</p>
  </section>
);
Folk.propTypes = {
  name: PropTypes.string.isRequired,
};
export default pure(Folk);
